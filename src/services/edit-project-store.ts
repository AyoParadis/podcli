import { execFileSync } from "child_process";
import { createHash, randomUUID } from "crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from "fs";
import { basename, join } from "path";
import { paths } from "../config/paths.js";
import type {
  EditOperation,
  EditProject,
  EditProjectSource,
  EditProjectSummary,
  TimelineSegment,
  TranscriptResult,
} from "../models/index.js";
import { writeFileAtomicSync } from "../utils/atomic-file.js";
import {
  deleteTimelineRange,
  remapTranscript,
  reorderSegment,
  splitSegment,
  timelineStats,
  trimSegment,
  validateTimeline,
} from "../utils/edit-project.js";

const HISTORY_LIMIT = 100;
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

interface ProjectSnapshot {
  name: string;
  timeline: TimelineSegment[];
}

interface StoredProject extends EditProject {
  undo_stack: ProjectSnapshot[];
  redo_stack: ProjectSnapshot[];
}

export class EditProjectConflictError extends Error {
  readonly currentRevision: number;

  constructor(currentRevision: number) {
    super(`Project is now revision ${currentRevision}`);
    this.name = "EditProjectConflictError";
    this.currentRevision = currentRevision;
  }
}

export class EditProjectStore {
  constructor() {
    mkdirSync(paths.projects, { recursive: true });
    mkdirSync(paths.projectTrash, { recursive: true });
    mkdirSync(paths.editCache, { recursive: true });
  }

  create(videoPath: string, transcript: TranscriptResult, name?: string, sourceFilename?: string): EditProject {
    const sourcePath = realpathSync(videoPath);
    if (!existsSync(sourcePath)) throw new Error("Source video does not exist");
    const source = this.probeSource(sourcePath, transcript.duration);
    if (sourceFilename?.trim()) source.filename = basename(sourceFilename.trim()).slice(0, 255);
    const id = randomUUID();
    const now = new Date().toISOString();
    const stored: StoredProject = {
      schema_version: 1,
      id,
      name: cleanProjectName(name || basename(sourcePath).replace(/\.[^.]+$/, "")),
      source,
      timeline: source.duration >= 0.04
        ? [{ id: randomUUID(), source_start: 0, source_end: roundMs(source.duration) }]
        : [],
      revision: 1,
      created_at: now,
      updated_at: now,
      undo_stack: [],
      redo_stack: [],
    };
    this.writeProject(stored, transcript, false);
    return publicProject(stored);
  }

  findBySourcePath(videoPath: string): EditProject | null {
    const resolved = realpathSync(videoPath);
    for (const summary of this.list().projects) {
      const stored = this.readProject(summary.id, false);
      if (stored.source.path === resolved) return publicProject(stored);
    }
    return null;
  }

  duplicate(
    id: string,
    name: string,
    fingerprint: string,
    timeline: TimelineSegment[],
  ): EditProject {
    const source = this.readProject(id, false);
    if (source.source.fingerprint !== fingerprint) throw new Error("Source fingerprint changed");
    const transcript = this.readTranscript(id, false);
    const duplicate = this.create(source.source.path, transcript, `${cleanProjectName(name)} copy`, source.source.filename);
    return this.replaceTimeline(duplicate.id, duplicate.revision, timeline);
  }

  list(): { projects: EditProjectSummary[]; trash: EditProjectSummary[] } {
    return {
      projects: this.listAt(paths.projects, false),
      trash: this.listAt(paths.projectTrash, true),
    };
  }

  get(id: string, includeTrash = false): { project: EditProject; transcript: TranscriptResult } {
    const stored = this.readProject(id, includeTrash);
    return { project: publicProject(stored), transcript: this.readTranscript(stored.id, Boolean(stored.trashed_at)) };
  }

  applyOperation(id: string, expectedRevision: number, operation: EditOperation): EditProject {
    const stored = this.readProject(id, false);
    this.assertRevision(stored, expectedRevision);
    assertOperation(operation);
    if (operation.type === "undo") return this.undo(stored);
    if (operation.type === "redo") return this.redo(stored);

    const before = snapshot(stored);
    let timeline = stored.timeline;
    let name = stored.name;
    switch (operation.type) {
      case "split":
        timeline = splitSegment(timeline, operation.segment_id, operation.source_time);
        break;
      case "trim":
        timeline = trimSegment(timeline, operation.segment_id, operation.edge, operation.source_time);
        break;
      case "delete_range":
        timeline = deleteTimelineRange(timeline, operation.timeline_start, operation.timeline_end);
        break;
      case "reorder":
        timeline = reorderSegment(timeline, operation.segment_id, operation.before_segment_id);
        break;
      case "rename":
        name = cleanProjectName(operation.name);
        break;
    }
    stored.timeline = validateTimeline(timeline, stored.source.duration);
    stored.name = name;
    stored.undo_stack = [...stored.undo_stack, before].slice(-HISTORY_LIMIT);
    stored.redo_stack = [];
    this.bumpAndWrite(stored);
    return publicProject(stored);
  }

  replaceTimeline(
    id: string,
    expectedRevision: number,
    timeline: TimelineSegment[],
  ): EditProject {
    const stored = this.readProject(id, false);
    this.assertRevision(stored, expectedRevision);
    stored.undo_stack = [...stored.undo_stack, snapshot(stored)].slice(-HISTORY_LIMIT);
    stored.redo_stack = [];
    stored.timeline = validateTimeline(timeline, stored.source.duration);
    this.bumpAndWrite(stored);
    return publicProject(stored);
  }

  relink(id: string, replacementPath: string): EditProject {
    const stored = this.readProject(id, false);
    const resolved = realpathSync(replacementPath);
    const fingerprint = fileFingerprint(resolved);
    if (fingerprint !== stored.source.fingerprint) throw new Error("Replacement file does not match this project");
    stored.source.path = resolved;
    this.bumpAndWrite(stored);
    return publicProject(stored);
  }

  activate(id: string, expectedRevision: number) {
    const { project, transcript } = this.get(id);
    if (project.revision !== expectedRevision) throw new EditProjectConflictError(project.revision);
    return { project, transcript: remapTranscript(transcript, project.timeline) };
  }

  trash(id: string): EditProject {
    const stored = this.readProject(id, false);
    stored.trashed_at = new Date().toISOString();
    stored.updated_at = stored.trashed_at;
    this.writeStoredOnly(stored, false);
    rmSync(join(paths.editCache, id), { recursive: true, force: true });
    renameSync(this.projectDir(id, false), this.projectDir(id, true));
    return publicProject(stored);
  }

  restore(id: string): EditProject {
    const stored = this.readProject(id, true);
    delete stored.trashed_at;
    stored.updated_at = new Date().toISOString();
    this.writeStoredOnly(stored, true);
    renameSync(this.projectDir(id, true), this.projectDir(id, false));
    return publicProject(stored);
  }

  purgeExpiredTrash(now = Date.now()): number {
    let purged = 0;
    for (const summary of this.listAt(paths.projectTrash, true)) {
      if (!summary.trashed_at) continue;
      if (now - new Date(summary.trashed_at).getTime() < TRASH_RETENTION_MS) continue;
      rmSync(this.projectDir(summary.id, true), { recursive: true, force: true });
      purged += 1;
    }
    return purged;
  }

  loadSourcePaths(): string[] {
    return this.list().projects
      .map((summary) => {
        try {
          return this.readProject(summary.id, false).source.path;
        } catch {
          return "";
        }
      })
      .filter(Boolean);
  }

  private undo(stored: StoredProject): EditProject {
    const previous = stored.undo_stack.pop();
    if (!previous) return publicProject(stored);
    stored.redo_stack = [...stored.redo_stack, snapshot(stored)].slice(-HISTORY_LIMIT);
    stored.name = cleanProjectName(previous.name);
    stored.timeline = validateTimeline(previous.timeline, stored.source.duration);
    this.bumpAndWrite(stored);
    return publicProject(stored);
  }

  private redo(stored: StoredProject): EditProject {
    const next = stored.redo_stack.pop();
    if (!next) return publicProject(stored);
    stored.undo_stack = [...stored.undo_stack, snapshot(stored)].slice(-HISTORY_LIMIT);
    stored.name = cleanProjectName(next.name);
    stored.timeline = validateTimeline(next.timeline, stored.source.duration);
    this.bumpAndWrite(stored);
    return publicProject(stored);
  }

  private bumpAndWrite(stored: StoredProject): void {
    stored.revision += 1;
    stored.updated_at = new Date().toISOString();
    this.writeStoredOnly(stored, false);
  }

  private assertRevision(stored: StoredProject, expected: number): void {
    if (stored.revision !== expected) throw new EditProjectConflictError(stored.revision);
  }

  private writeProject(stored: StoredProject, transcript: TranscriptResult, trash: boolean): void {
    const dir = this.projectDir(stored.id, trash);
    mkdirSync(dir, { recursive: true });
    writeFileAtomicSync(join(dir, "transcript.json"), JSON.stringify(transcript));
    this.writeStoredOnly(stored, trash);
  }

  private writeStoredOnly(stored: StoredProject, trash: boolean): void {
    const dir = this.projectDir(stored.id, trash);
    mkdirSync(dir, { recursive: true });
    writeFileAtomicSync(join(dir, "project.json"), JSON.stringify(stored, null, 2));
  }

  private readProject(id: string, trash: boolean): StoredProject {
    assertId(id);
    const file = join(this.projectDir(id, trash), "project.json");
    if (!existsSync(file)) throw new Error("Edit project not found");
    const stored = JSON.parse(readFileSync(file, "utf-8")) as StoredProject;
    stored.timeline = validateTimeline(stored.timeline, stored.source.duration);
    stored.undo_stack = Array.isArray(stored.undo_stack) ? stored.undo_stack.slice(-HISTORY_LIMIT) : [];
    stored.redo_stack = Array.isArray(stored.redo_stack) ? stored.redo_stack.slice(-HISTORY_LIMIT) : [];
    return stored;
  }

  private readTranscript(id: string, trash: boolean): TranscriptResult {
    return JSON.parse(readFileSync(join(this.projectDir(id, trash), "transcript.json"), "utf-8")) as TranscriptResult;
  }

  private listAt(root: string, trash: boolean): EditProjectSummary[] {
    if (!existsSync(root)) return [];
    const entries = [] as EditProjectSummary[];
    for (const id of readdirSync(root)) {
      try {
        const stored = this.readProject(id, trash);
        entries.push({
          id: stored.id,
          name: stored.name,
          source_filename: stored.source.filename,
          ...timelineStats(stored.source.duration, stored.timeline),
          revision: stored.revision,
          updated_at: stored.updated_at,
          trashed_at: stored.trashed_at,
          source_missing: !existsSync(stored.source.path),
        });
      } catch {
        // Ignore malformed project directories; a valid project remains available.
      }
    }
    return entries.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  private projectDir(id: string, trash: boolean): string {
    return join(trash ? paths.projectTrash : paths.projects, id);
  }

  private probeSource(sourcePath: string, fallbackDuration: number): EditProjectSource {
    let width = 0;
    let height = 0;
    let fps = 0;
    let duration = fallbackDuration;
    let hasAudio = true;
    try {
      const raw = execFileSync(paths.ffprobePath, [
        "-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate",
        "-of", "json", sourcePath,
      ], { encoding: "utf-8", maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
      const data = JSON.parse(raw) as {
        format?: { duration?: string };
        streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; r_frame_rate?: string }>;
      };
      const video = data.streams?.find((stream) => stream.codec_type === "video");
      width = Number(video?.width) || 0;
      height = Number(video?.height) || 0;
      const [numerator, denominator] = String(video?.r_frame_rate || "0/1").split("/").map(Number);
      fps = denominator ? numerator / denominator : 0;
      duration = Number(data.format?.duration) || fallbackDuration;
      hasAudio = Boolean(data.streams?.some((stream) => stream.codec_type === "audio" && stream.codec_name && stream.codec_name !== "none"));
    } catch {
      // Transcript duration still gives a usable project when ffprobe is unavailable.
    }
    return {
      path: sourcePath,
      fingerprint: fileFingerprint(sourcePath),
      filename: basename(sourcePath),
      duration: roundMs(duration),
      width,
      height,
      fps: roundMs(fps),
      has_audio: hasAudio,
    };
  }
}

function snapshot(stored: StoredProject): ProjectSnapshot {
  return { name: stored.name, timeline: stored.timeline.map((segment) => ({ ...segment })) };
}

function publicProject(stored: StoredProject): EditProject {
  const { undo_stack: _undo, redo_stack: _redo, ...project } = stored;
  return structuredClone(project);
}

function cleanProjectName(value: string): string {
  const name = String(value).trim().replace(/[\r\n\t]+/g, " ").slice(0, 120);
  if (!name) throw new Error("Project name cannot be empty");
  return name;
}

function assertId(id: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid project id");
}

function assertOperation(operation: EditOperation): void {
  if (!operation || typeof operation !== "object") throw new Error("Edit operation is required");
  const allowed = new Set(["split", "trim", "delete_range", "reorder", "undo", "redo", "rename"]);
  if (!allowed.has(operation.type)) throw new Error("Unsupported edit operation");
  if (operation.type === "split" && (typeof operation.segment_id !== "string" || !Number.isFinite(operation.source_time))) {
    throw new Error("Split requires a segment and source time");
  }
  if (operation.type === "trim" && (typeof operation.segment_id !== "string" || !["start", "end"].includes(operation.edge) || !Number.isFinite(operation.source_time))) {
    throw new Error("Trim requires a segment, edge, and source time");
  }
  if (operation.type === "delete_range" && (!Number.isFinite(operation.timeline_start) || !Number.isFinite(operation.timeline_end))) {
    throw new Error("Delete requires a valid timeline range");
  }
  if (operation.type === "reorder" && (typeof operation.segment_id !== "string" || (operation.before_segment_id !== null && typeof operation.before_segment_id !== "string"))) {
    throw new Error("Reorder requires valid segment ids");
  }
  if (operation.type === "rename" && typeof operation.name !== "string") throw new Error("Rename requires a name");
}

function roundMs(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function fileFingerprint(filePath: string): string {
  // getFileHash is asynchronous because it streams. Project mutations are serialized
  // synchronously, so reproduce its documented first-10MB + size fingerprint here.
  const size = statSync(filePath).size;
  const fd = openSync(filePath, "r");
  const buffer = Buffer.alloc(Math.min(size, 10 * 1024 * 1024));
  try {
    readSync(fd, buffer, 0, buffer.length, 0);
  } finally {
    closeSync(fd);
  }
  return createHash("sha256").update(buffer).update(`size:${size}`).digest("hex").slice(0, 16);
}
