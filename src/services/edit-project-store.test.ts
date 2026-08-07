import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { join } from "path";
import { tmpdir } from "os";
import { paths } from "../config/paths.js";
import type { TranscriptResult } from "../models/index.js";
import { EditProjectConflictError, EditProjectStore } from "./edit-project-store.js";

const originalPaths = {
  projects: paths.projects,
  projectTrash: paths.projectTrash,
  editCache: paths.editCache,
};

const transcript: TranscriptResult = {
  transcript: "hello world",
  duration: 10,
  language: "en",
  segments: [],
  words: [{ word: "hello", start: 0, end: 1, confidence: 1 }],
  speakers: { num_speakers: 0, speakers: {} },
  speaker_segments: [],
};

let root = "";
let source = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "podclip-edit-store-"));
  paths.projects = join(root, "projects");
  paths.projectTrash = join(root, "trash");
  paths.editCache = join(root, "cache");
  source = join(root, "episode.mp4");
  writeFileSync(source, "untouched raw source");
});

afterEach(() => {
  paths.projects = originalPaths.projects;
  paths.projectTrash = originalPaths.projectTrash;
  paths.editCache = originalPaths.editCache;
  rmSync(root, { recursive: true, force: true });
});

describe("EditProjectStore", () => {
  it("persists order, undo, redo, and revision conflicts", () => {
    const store = new EditProjectStore();
    let project = store.create(source, transcript);
    const first = project.timeline[0];
    project = store.applyOperation(project.id, project.revision, {
      type: "split", segment_id: first.id, source_time: 4,
    });
    const second = project.timeline[1];
    project = store.applyOperation(project.id, project.revision, {
      type: "reorder", segment_id: second.id, before_segment_id: first.id,
    });
    expect(new EditProjectStore().get(project.id).project.timeline.map((item) => item.source_start)).toEqual([4, 0]);

    const staleRevision = project.revision - 1;
    expect(() => store.applyOperation(project.id, staleRevision, { type: "undo" }))
      .toThrow(EditProjectConflictError);
    project = store.applyOperation(project.id, project.revision, { type: "undo" });
    expect(project.timeline.map((item) => item.source_start)).toEqual([0, 4]);
    project = store.applyOperation(project.id, project.revision, { type: "redo" });
    expect(project.timeline.map((item) => item.source_start)).toEqual([4, 0]);
  });

  it("preserves the original upload filename as project metadata", () => {
    const store = new EditProjectStore();
    const project = store.create(source, transcript, "CEO conversation", "CEO conversation.mov");
    expect(project.name).toBe("CEO conversation");
    expect(project.source.filename).toBe("CEO conversation.mov");
    const duplicate = store.duplicate(project.id, project.name, project.source.fingerprint, project.timeline);
    expect(duplicate.source.filename).toBe("CEO conversation.mov");
  });

  it("keeps only 100 undo snapshots", () => {
    const store = new EditProjectStore();
    let project = store.create(source, transcript);
    for (let index = 0; index < 110; index += 1) {
      project = store.applyOperation(project.id, project.revision, { type: "rename", name: `Episode ${index}` });
    }
    const stored = JSON.parse(readFileSync(join(paths.projects, project.id, "project.json"), "utf-8"));
    expect(stored.undo_stack).toHaveLength(100);
  });

  it("trashes metadata and disposable cache without touching raw media", () => {
    const store = new EditProjectStore();
    const project = store.create(source, transcript);
    const hashBefore = createHash("sha256").update(readFileSync(source)).digest("hex");
    const mtimeBefore = statSync(source).mtimeMs;
    mkdirSync(join(paths.editCache, project.id), { recursive: true });
    writeFileSync(join(paths.editCache, project.id, "proxy.mp4"), "cache", { flag: "wx" });
    store.trash(project.id);
    expect(existsSync(source)).toBe(true);
    expect(existsSync(join(paths.editCache, project.id))).toBe(false);
    expect(store.list().trash[0].id).toBe(project.id);
    store.restore(project.id);
    expect(store.get(project.id).project.trashed_at).toBeUndefined();
    expect(createHash("sha256").update(readFileSync(source)).digest("hex")).toBe(hashBefore);
    expect(statSync(source).mtimeMs).toBe(mtimeBefore);
  });

  it("undoes and redoes a silence timeline as one history entry", () => {
    const store = new EditProjectStore();
    let project = store.create(source, transcript);
    project = store.replaceTimeline(project.id, project.revision, [
      { id: project.timeline[0].id, source_start: 0, source_end: 2 },
      { id: "00000000-0000-4000-8000-000000000001", source_start: 4, source_end: 10 },
    ]);
    expect(project.timeline).toHaveLength(2);
    project = store.applyOperation(project.id, project.revision, { type: "undo" });
    expect(project.timeline).toHaveLength(1);
    project = store.applyOperation(project.id, project.revision, { type: "redo" });
    expect(project.timeline).toHaveLength(2);
  });

  it("purges expired project metadata without deleting the raw source", () => {
    const store = new EditProjectStore();
    const project = store.create(source, transcript);
    store.trash(project.id);
    expect(store.purgeExpiredTrash(Date.now() + 31 * 24 * 60 * 60 * 1000)).toBe(1);
    expect(existsSync(source)).toBe(true);
    expect(store.list().trash).toHaveLength(0);
  });

  it("relinks only an identical fingerprint", () => {
    const store = new EditProjectStore();
    const project = store.create(source, transcript, "Episode", "Original recording.mov");
    const matching = join(root, "moved.mp4");
    copyFileSync(source, matching);
    const relinked = store.relink(project.id, matching);
    expect(relinked.source.path).toBe(realpathSync(matching));
    expect(relinked.source.filename).toBe("Original recording.mov");
    const different = join(root, "different.mp4");
    writeFileSync(different, "other media");
    expect(() => store.relink(project.id, different)).toThrow(/does not match/);
  });

  it("ignores an interrupted temp save and reopens the previous project", () => {
    const store = new EditProjectStore();
    const project = store.create(source, transcript);
    const projectFile = join(paths.projects, project.id, "project.json");
    writeFileSync(`${projectFile}.interrupted.tmp`, "{truncated");
    const reopened = new EditProjectStore().get(project.id).project;
    expect(reopened).toEqual(project);
  });
});
