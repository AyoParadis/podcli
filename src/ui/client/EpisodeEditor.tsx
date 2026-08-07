import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Captions,
  Check,
  ChevronLeft,
  CopyPlus,
  Pause,
  Play,
  Redo2,
  Scissors,
  Trash2,
  Undo2,
  Volume2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { EditOperation, EditProject, TimelineSegment, TranscriptResult } from "../../models/index.js";
import {
  buildPhraseBlocks,
  editedDuration,
  mapEditedTimeToSource,
  phraseSelectionRange,
  positionTimeline,
  remapTranscript,
} from "../../utils/edit-project.js";
import { ApiError, api, fmtMs, formatTranscriptText, friendlyProjectName } from "./lib";
import CopyButton from "./CopyButton";
import { assetSrc } from "./useAssets";

type SaveState = "saved" | "saving" | "unsaved";
type PreviewAssets = { waveform?: string | null; storyboard?: string | null; proxy?: string | null };
type BackgroundJob<T> = { status: "pending" | "running" | "done" | "error"; message?: string; error?: string; result?: T };
type EditorSettings = {
  captionStyle?: string;
  captionPosition?: string;
  captionFontScale?: number;
  logoPath?: string;
  logoPosition?: string;
  silenceThreshold?: number;
  silenceMinPause?: number;
  silencePadding?: number;
};
type SilenceProposal = {
  proposal_id: string;
  revision: number;
  removed_ranges: Array<{ start: number; end: number }>;
  edited_duration: number;
  cut_count: number;
};

const streamSource = (path: string) => `/api/stream-source?path=${encodeURIComponent(path)}`;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

async function waitForJob<T>(jobId: string, onUpdate?: (job: BackgroundJob<T>) => void): Promise<T> {
  for (;;) {
    const job = await api<BackgroundJob<T>>(`/job/${jobId}`);
    onUpdate?.(job);
    if (job.status === "done") return job.result as T;
    if (job.status === "error") throw new Error(job.error || job.message || "Background job failed");
    await new Promise((resolve) => window.setTimeout(resolve, 650));
  }
}

export default function EpisodeEditor() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<EditProject | null>(null);
  const [editedTranscript, setEditedTranscript] = useState<TranscriptResult | null>(null);
  const [draftName, setDraftName] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  const [sourceMissing, setSourceMissing] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const [phraseSelection, setPhraseSelection] = useState<{ anchor: number; focus: number } | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(2);
  const [showOverlays, setShowOverlays] = useState(false);
  const [settings, setSettings] = useState<EditorSettings>({});
  const [previewAssets, setPreviewAssets] = useState<PreviewAssets>({});
  const [optimizing, setOptimizing] = useState(false);
  const [silence, setSilence] = useState<SilenceProposal | null>(null);
  const [silenceStatus, setSilenceStatus] = useState<string | null>(null);
  const [trimDraft, setTrimDraft] = useState<{ id: string; edge: "start" | "end"; sourceTime: number } | null>(null);

  const videoRefs = [useRef<HTMLVideoElement>(null), useRef<HTMLVideoElement>(null)] as const;
  const [activeSlot, setActiveSlot] = useState<0 | 1>(0);
  const activeSlotRef = useRef<0 | 1>(0);
  const segmentIndexRef = useRef(0);
  const seekFailures = useRef(0);
  const previewRequestInFlight = useRef(false);
  const playheadRef = useRef(0);
  const rangeDrag = useRef<{ start: number } | null>(null);
  const dragSegment = useRef<string | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [timelineViewportWidth, setTimelineViewportWidth] = useState(920);

  const positions = useMemo(() => positionTimeline(project?.timeline ?? []), [project?.timeline]);
  const duration = useMemo(() => editedDuration(project?.timeline ?? []), [project?.timeline]);
  const phrases = useMemo(() => buildPhraseBlocks(editedTranscript?.words ?? []), [editedTranscript?.words]);
  const previewSrc = previewAssets.proxy || (project ? streamSource(project.source.path) : "");
  const timelineWidth = Math.max(timelineViewportWidth, duration * zoom);
  const timelineScale = timelineWidth / Math.max(duration, 0.001);
  const playheadX = (playhead / Math.max(duration, 0.001)) * timelineWidth;
  const playheadGrabWidth = 48;
  const playheadLeft = clamp(playheadX - playheadGrabWidth / 2, 0, Math.max(0, timelineWidth - playheadGrabWidth));
  const playheadLineX = clamp(playheadX - playheadLeft, 0, playheadGrabWidth);
  const playheadMarkerX = clamp(playheadLineX, 10, playheadGrabWidth - 10);

  useEffect(() => { playheadRef.current = playhead; }, [playhead]);

  useEffect(() => {
    const element = timelineScrollRef.current;
    if (!element) return;
    const update = () => setTimelineViewportWidth(Math.max(1, element.clientWidth));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [project?.id]);

  const loadProject = useCallback(async () => {
    const data = await api<{ project: EditProject; transcript: TranscriptResult; source_missing?: boolean }>(`/edit-projects/${id}`);
    setProject(data.project);
    setEditedTranscript(remapTranscript(data.transcript, data.project.timeline));
    setDraftName(friendlyProjectName(data.project.name, data.project.source.filename));
    setSourceMissing(Boolean(data.source_missing));
    setConflict(false);
    setSaveState("saved");
    return data.project;
  }, [id]);

  useEffect(() => {
    void Promise.all([loadProject(), api<{ settings?: EditorSettings }>("/ui-state")])
      .then(([, state]) => setSettings(state.settings || {}))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not open project"));
  }, [loadProject]);

  const preparePreview = useCallback(async (proxyReason?: "playback_error" | "seek_timeout") => {
    if (!id || previewRequestInFlight.current) return;
    previewRequestInFlight.current = true;
    if (proxyReason) setOptimizing(true);
    try {
      const start = await api<{ job_id: string }>(`/edit-projects/${id}/prepare-preview`, {
        method: "POST",
        body: JSON.stringify(proxyReason ? { proxy_reason: proxyReason } : {}),
      });
      const result = await waitForJob<PreviewAssets>(start.job_id);
      setPreviewAssets(result || {});
      seekFailures.current = 0;
    } catch (err) {
      if (proxyReason) setError(err instanceof Error ? err.message : "Preview optimization failed");
    } finally {
      previewRequestInFlight.current = false;
      if (proxyReason) setOptimizing(false);
    }
  }, [id]);

  useEffect(() => { if (project?.id) void preparePreview(); }, [project?.id, preparePreview]);

  const applyOperation = useCallback(async (operation: EditOperation) => {
    if (!project || conflict) return null;
    setSaveState("saving");
    setError(null);
    try {
      const data = await api<{ project: EditProject; transcript: TranscriptResult }>(`/edit-projects/${project.id}/operations`, {
        method: "POST",
        body: JSON.stringify({ expected_revision: project.revision, operation }),
      });
      setProject(data.project);
      setEditedTranscript(data.transcript);
      setDraftName(friendlyProjectName(data.project.name, data.project.source.filename));
      setSaveState("saved");
      setSilence(null);
      setRange(null);
      return data.project;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setSaveState("unsaved");
        setConflict(true);
      } else {
        setSaveState("saved");
        setError(err instanceof Error ? err.message : "Could not save edit");
      }
      return null;
    }
  }, [project, conflict]);

  const duplicateCurrent = async () => {
    if (!project) return;
    try {
      const data = await api<{ project: EditProject }>(`/edit-projects/${project.id}/duplicate`, {
        method: "POST",
        body: JSON.stringify({
          name: draftName || project.name,
          source_fingerprint: project.source.fingerprint,
          timeline: project.timeline,
        }),
      });
      navigate(`/editor/${data.project.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not duplicate edit");
    }
  };

  const requestProxy = useCallback((reason: "playback_error" | "seek_timeout") => {
    if (!previewAssets.proxy) void preparePreview(reason);
  }, [previewAssets.proxy, preparePreview]);

  const watchSeek = useCallback((video: HTMLVideoElement, sourceTime: number) => {
    let complete = false;
    const done = () => { complete = true; seekFailures.current = 0; window.clearTimeout(timer); };
    const timer = window.setTimeout(() => {
      if (complete) return;
      video.removeEventListener("seeked", done);
      seekFailures.current += 1;
      if (seekFailures.current >= 2) requestProxy("seek_timeout");
    }, 2500);
    video.addEventListener("seeked", done, { once: true });
    try { video.currentTime = sourceTime; } catch {
      video.removeEventListener("seeked", done);
      window.clearTimeout(timer);
    }
  }, [requestProxy]);

  const preloadFollowing = useCallback((currentIndex: number, slot: 0 | 1) => {
    const following = positions[currentIndex + 1];
    const standby = videoRefs[slot === 0 ? 1 : 0].current;
    if (following && standby) watchSeek(standby, following.source_start);
  }, [positions, watchSeek]);

  useEffect(() => {
    if (!project?.timeline.length) {
      setPlayhead(0);
      setPlaying(false);
      return;
    }
    const nextTime = clamp(playheadRef.current, 0, editedDuration(project.timeline));
    const target = mapEditedTimeToSource(project.timeline, nextTime);
    const video = videoRefs[activeSlotRef.current].current;
    if (!target || !video) return;
    segmentIndexRef.current = target.segment_index;
    setPlayhead(nextTime);
    const applySeek = () => {
      watchSeek(video, target.source_time);
      preloadFollowing(target.segment_index, activeSlotRef.current);
    };
    if (video.readyState >= 1) applySeek();
    else video.addEventListener("loadedmetadata", applySeek, { once: true });
    return () => video.removeEventListener("loadedmetadata", applySeek);
  }, [project, previewSrc, watchSeek, preloadFollowing]);

  const seekEdited = useCallback((time: number, keepPlaying = playing) => {
    if (!project?.timeline.length) return;
    const target = mapEditedTimeToSource(project.timeline, clamp(time, 0, duration));
    if (!target) return;
    segmentIndexRef.current = target.segment_index;
    const video = videoRefs[activeSlotRef.current].current;
    if (!video) return;
    watchSeek(video, target.source_time);
    setPlayhead(clamp(time, 0, duration));
    preloadFollowing(target.segment_index, activeSlotRef.current);
    if (keepPlaying) void video.play().catch(() => {});
  }, [project, duration, playing, watchSeek, preloadFollowing]);

  const switchToSegment = useCallback((nextIndex: number) => {
    if (!project || nextIndex >= positions.length) {
      setPlaying(false);
      videoRefs[activeSlotRef.current].current?.pause();
      setPlayhead(duration);
      return;
    }
    const nextSlot = (activeSlotRef.current === 0 ? 1 : 0) as 0 | 1;
    const video = videoRefs[nextSlot].current;
    if (!video) return;
    videoRefs[activeSlotRef.current].current?.pause();
    segmentIndexRef.current = nextIndex;
    watchSeek(video, positions[nextIndex].source_start);
    activeSlotRef.current = nextSlot;
    setActiveSlot(nextSlot);
    setPlayhead(positions[nextIndex].timeline_start);
    void video.play().catch(() => {});
    preloadFollowing(nextIndex, nextSlot);
  }, [project, positions, duration, watchSeek, preloadFollowing]);

  const updateFromFrame = useCallback((slot: 0 | 1) => {
    if (slot !== activeSlotRef.current) return;
    const video = videoRefs[slot].current;
    const positioned = positions[segmentIndexRef.current];
    if (!video || !positioned) return;
    const edited = positioned.timeline_start + video.currentTime - positioned.source_start;
    setPlayhead(clamp(edited, positioned.timeline_start, positioned.timeline_end));
    if (!video.paused && video.currentTime >= positioned.source_end - 0.012) {
      switchToSegment(segmentIndexRef.current + 1);
    }
  }, [positions, switchToSegment]);

  useEffect(() => {
    const video = videoRefs[activeSlot].current as HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: () => void) => number;
      cancelVideoFrameCallback?: (id: number) => void;
    };
    if (!video?.requestVideoFrameCallback) return;
    let stopped = false;
    let frame = 0;
    const tick = () => {
      if (stopped) return;
      updateFromFrame(activeSlot);
      frame = video.requestVideoFrameCallback!(tick);
    };
    frame = video.requestVideoFrameCallback(tick);
    return () => { stopped = true; video.cancelVideoFrameCallback?.(frame); };
  }, [activeSlot, updateFromFrame, project?.revision]);

  const togglePlayback = () => {
    const video = videoRefs[activeSlotRef.current].current;
    if (!video || !project?.timeline.length) return;
    if (video.paused) {
      if (playhead >= duration - 0.01) seekEdited(0, false);
      void video.play().catch(() => {});
    } else video.pause();
  };

  const splitAtPlayhead = useCallback(() => {
    if (!project) return;
    const target = mapEditedTimeToSource(project.timeline, playhead);
    const segment = target ? project.timeline.find((item) => item.id === target.segment_id) : null;
    if (!target || !segment) return;
    if (target.source_time <= segment.source_start + 0.04 || target.source_time >= segment.source_end - 0.04) return;
    void applyOperation({ type: "split", segment_id: target.segment_id, source_time: target.source_time });
  }, [project, playhead, applyOperation]);

  const deleteSelection = useCallback(() => {
    if (!project) return;
    if (phraseSelection) {
      const selected = phraseSelectionRange(phrases, phraseSelection.anchor, phraseSelection.focus);
      void applyOperation({ type: "delete_range", timeline_start: selected.start, timeline_end: selected.end });
      setPhraseSelection(null);
      return;
    }
    if (range && Math.abs(range.end - range.start) >= 0.04) {
      void applyOperation({ type: "delete_range", timeline_start: range.start, timeline_end: range.end });
      return;
    }
    const selected = positions.find((segment) => segment.id === selectedSegmentId);
    if (selected) void applyOperation({ type: "delete_range", timeline_start: selected.timeline_start, timeline_end: selected.timeline_end });
  }, [project, phraseSelection, phrases, range, positions, selectedSegmentId, applyOperation]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.code === "Space") { event.preventDefault(); togglePlayback(); }
      else if (event.key.toLowerCase() === "s" && !event.metaKey) { event.preventDefault(); splitAtPlayhead(); }
      else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deleteSelection(); }
      else if (event.metaKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void applyOperation({ type: event.shiftKey ? "redo" : "undo" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlayback, splitAtPlayhead, deleteSelection, applyOperation]);

  const useEditedEpisode = async () => {
    if (!project?.timeline.length) return;
    try {
      await api(`/edit-projects/${project.id}/activate`, {
        method: "POST",
        body: JSON.stringify({ expected_revision: project.revision }),
      });
      navigate("/episode");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setConflict(true);
      else setError(err instanceof Error ? err.message : "Could not activate this edit");
    }
  };

  const relinkSource = async () => {
    if (!project) return;
    try {
      const picked = await api<{ file_path?: string }>("/browse-file");
      if (!picked.file_path) return;
      await api(`/edit-projects/${project.id}/relink`, {
        method: "POST",
        body: JSON.stringify({ path: picked.file_path }),
      });
      await loadProject();
      setPreviewAssets({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "That file does not match this project");
    }
  };

  const findSilences = async () => {
    if (!project) return;
    setSilenceStatus("Analyzing speech locally…");
    setError(null);
    try {
      const start = await api<{ job_id: string }>(`/edit-projects/${project.id}/analyze-silence`, {
        method: "POST",
        body: JSON.stringify({
          expected_revision: project.revision,
          threshold: settings.silenceThreshold ?? 0.5,
          min_silence_seconds: settings.silenceMinPause ?? 0.65,
          padding_seconds: settings.silencePadding ?? 0.12,
        }),
      });
      const result = await waitForJob<SilenceProposal>(start.job_id, (job) => setSilenceStatus(job.message || "Analyzing speech locally…"));
      setSilence(result);
      setSilenceStatus(null);
    } catch (err) {
      setSilenceStatus(null);
      if (err instanceof ApiError && err.status === 409) setConflict(true);
      else setError(err instanceof Error ? err.message : "Silence analysis failed");
    }
  };

  const applySilence = async () => {
    if (!project || !silence) return;
    setSaveState("saving");
    try {
      const data = await api<{ project: EditProject; transcript: TranscriptResult }>(
        `/edit-projects/${project.id}/silence-proposals/${silence.proposal_id}/apply`,
        { method: "POST" },
      );
      setProject(data.project);
      setEditedTranscript(data.transcript);
      setSilence(null);
      setSaveState("saved");
    } catch (err) {
      setSaveState("unsaved");
      if (err instanceof ApiError && err.status === 409) setConflict(true);
      else setError(err instanceof Error ? err.message : "Could not apply silence plan");
    }
  };

  const timelineTimeAt = (event: React.PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return clamp(((event.clientX - rect.left) / rect.width) * duration, 0, duration);
  };

  const beginRange = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = timelineTimeAt(event);
    rangeDrag.current = { start };
    setRange({ start, end: start });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveRange = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!rangeDrag.current) return;
    setRange({ start: rangeDrag.current.start, end: timelineTimeAt(event) });
  };

  const endRange = (event: React.PointerEvent<HTMLDivElement>) => {
    rangeDrag.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ }
  };

  const timelineTimeFromClientX = useCallback((clientX: number) => {
    const element = timelineRef.current;
    if (!element) return playhead;
    const rect = element.getBoundingClientRect();
    return clamp(((clientX - rect.left) / Math.max(rect.width, 1)) * duration, 0, duration);
  }, [duration, playhead]);

  const previewScrub = useCallback((time: number) => {
    if (!project?.timeline.length) return;
    const nextTime = clamp(time, 0, duration);
    const target = mapEditedTimeToSource(project.timeline, nextTime);
    if (!target) return;
    for (const ref of videoRefs) ref.current?.pause();
    segmentIndexRef.current = target.segment_index;
    const video = videoRefs[activeSlotRef.current].current;
    if (video) {
      try { video.currentTime = target.source_time; } catch { /* source may still be loading */ }
    }
    setPlayhead(nextTime);
  }, [project, duration]);

  const beginScrub = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!project?.timeline.length) return;
    event.preventDefault();
    event.stopPropagation();
    const timelineElement = timelineRef.current;
    if (!timelineElement) return;
    const captureTarget = event.currentTarget;
    const pointerId = event.pointerId;
    const timelineRect = timelineElement.getBoundingClientRect();
    const isPlayhead = captureTarget.classList.contains("edit-playhead");
    const exactPlayheadClientX = timelineRect.left + (playhead / Math.max(duration, 0.001)) * timelineRect.width;
    const grabOffsetX = isPlayhead ? event.clientX - exactPlayheadClientX : 0;
    try { captureTarget.setPointerCapture(pointerId); } catch { /* window listeners still preserve the drag */ }
    let finalTime = isPlayhead ? playhead : timelineTimeFromClientX(event.clientX);
    if (!isPlayhead) previewScrub(finalTime);
    const onMove = (move: PointerEvent) => {
      finalTime = timelineTimeFromClientX(move.clientX - grabOffsetX);
      previewScrub(finalTime);
    };
    const onFinish = (finish: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onFinish);
      window.removeEventListener("pointercancel", onFinish);
      try { if (captureTarget.hasPointerCapture(pointerId)) captureTarget.releasePointerCapture(pointerId); } catch { /* already released */ }
      if (finish.type !== "pointercancel") finalTime = timelineTimeFromClientX(finish.clientX - grabOffsetX);
      seekEdited(finalTime, false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onFinish, { once: true });
    window.addEventListener("pointercancel", onFinish, { once: true });
  }, [project, playhead, duration, timelineTimeFromClientX, previewScrub, seekEdited]);

  const startTrim = (event: React.PointerEvent<HTMLButtonElement>, segment: TimelineSegment, edge: "start" | "end") => {
    if (!project) return;
    event.preventDefault();
    event.stopPropagation();
    const sourceDuration = project.source.duration;
    const origin = event.clientX;
    const initial = edge === "start" ? segment.source_start : segment.source_end;
    const other = edge === "start" ? segment.source_end : segment.source_start;
    event.currentTarget.setPointerCapture(event.pointerId);
    const onMove = (move: PointerEvent) => {
      const delta = (move.clientX - origin) / timelineScale;
      const sourceTime = edge === "start"
        ? clamp(initial + delta, 0, other - 0.04)
        : clamp(initial + delta, other + 0.04, sourceDuration);
      setTrimDraft({ id: segment.id, edge, sourceTime });
    };
    const onUp = (up: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const delta = (up.clientX - origin) / timelineScale;
      const sourceTime = edge === "start"
        ? clamp(initial + delta, 0, other - 0.04)
        : clamp(initial + delta, other + 0.04, sourceDuration);
      setTrimDraft(null);
      void applyOperation({ type: "trim", segment_id: segment.id, edge, source_time: sourceTime });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };

  const selectedPhraseRange = phraseSelection
    ? [Math.min(phraseSelection.anchor, phraseSelection.focus), Math.max(phraseSelection.anchor, phraseSelection.focus)]
    : null;
  const currentWord = editedTranscript?.words.find((word) => playhead >= word.start && playhead <= word.end + 0.25);
  const currentWordIndex = currentWord ? editedTranscript?.words.indexOf(currentWord) ?? -1 : -1;
  const captionPreviewWords = currentWordIndex >= 0
    ? (editedTranscript?.words ?? []).slice(Math.max(0, currentWordIndex - 1), currentWordIndex + 3)
    : [];
  const splitTarget = mapEditedTimeToSource(project?.timeline ?? [], playhead);
  const splitTargetSegment = splitTarget
    ? project?.timeline.find((segment) => segment.id === splitTarget.segment_id)
    : null;
  const canSplit = Boolean(splitTarget && splitTargetSegment
    && splitTarget.source_time > splitTargetSegment.source_start + 0.04
    && splitTarget.source_time < splitTargetSegment.source_end - 0.04);
  const captionBottom = settings.captionPosition === "upper" ? "58%" : settings.captionPosition === "center" ? "42%" : "12%";
  const timelineIsUnchanged = Boolean(project
    && project.timeline.length === 1
    && Math.abs(project.timeline[0].source_start) < 0.001
    && Math.abs(project.timeline[0].source_end - project.source.duration) < 0.001);

  if (!project || !editedTranscript) {
    return <div className="edit-loading"><div className="spinner" /> Opening editor…</div>;
  }

  return (
    <div className="episode-editor">
      <header className="edit-topbar">
        <div className="edit-title-group">
          <Link to="/editor" className="edit-back" aria-label="Back to projects"><ChevronLeft size={18} /></Link>
          <div>
            <div className="edit-eyebrow">Edit episode</div>
            <input
              className="edit-title-input"
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              onBlur={() => { if (draftName.trim() && draftName.trim() !== project.name) void applyOperation({ type: "rename", name: draftName }); }}
              onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
              aria-label="Project name"
            />
          </div>
        </div>
        <div className={`edit-save-state ${saveState}`}>
          {saveState === "saved" && <Check size={14} />}{saveState === "saving" ? "Saving…" : saveState === "unsaved" ? "Unsaved" : "Saved"}
        </div>
        <div className="edit-top-actions">
          <button className="btn btn-primary btn-sm" onClick={useEditedEpisode} disabled={!project.timeline.length}>Use edited episode</button>
        </div>
      </header>

      {error && <div className="edit-banner error">{error}<button onClick={() => setError(null)}>Dismiss</button></div>}
      {sourceMissing && <div className="edit-banner conflict"><div><strong>Source video is missing</strong><span>Choose the same file in its new location. Its fingerprint must match.</span></div><button className="btn btn-primary btn-sm" onClick={relinkSource}>Relink source…</button></div>}
      {conflict && (
        <div className="edit-banner conflict">
          <div><strong>This project changed in another window.</strong><span>Choose which edit to continue.</span></div>
          <button className="btn btn-ghost btn-sm" onClick={() => void loadProject()}>Reload saved project</button>
          <button className="btn btn-primary btn-sm" onClick={duplicateCurrent}><CopyPlus size={14} /> Duplicate my current edit</button>
        </div>
      )}
      {silence && (
        <div className="edit-banner silence-review">
          <div><strong>Silence review ready</strong><span>{silence.cut_count} cuts · edited episode becomes {fmtMs(silence.edited_duration)}</span></div>
          <button className="btn btn-ghost btn-sm" onClick={() => setSilence(null)}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={applySilence}>Apply as one edit</button>
        </div>
      )}

      <section className="edit-stage">
        <div className="edit-preview-column">
          <div className="edit-preview">
            {[0, 1].map((slot) => (
              <video
                key={`${slot}-${previewSrc}`}
                ref={videoRefs[slot as 0 | 1]}
                src={previewSrc}
                preload="auto"
                playsInline
                className={activeSlot === slot ? "active" : "standby"}
                onPlay={() => { if (activeSlotRef.current === slot) setPlaying(true); }}
                onPause={() => { if (activeSlotRef.current === slot) setPlaying(false); }}
                onTimeUpdate={() => updateFromFrame(slot as 0 | 1)}
                onError={() => requestProxy("playback_error")}
              />
            ))}
            {showOverlays && currentWord && <div className={`edit-caption-preview ${settings.captionStyle || "branded"}`} style={{ bottom: captionBottom, fontSize: `clamp(16px, ${2.2 * (Number(settings.captionFontScale) || 100) / 100}vw, ${34 * (Number(settings.captionFontScale) || 100) / 100}px)` }}>{captionPreviewWords.map((word, index) => <React.Fragment key={`${word.start}-${index}`}>{index > 0 && " "}<span className={word === currentWord ? "active" : ""}>{word.word}</span></React.Fragment>)}</div>}
            {showOverlays && settings.logoPath && <img className={`edit-logo-preview ${settings.logoPosition || "top-left"}`} src={assetSrc(settings.logoPath)} alt="Logo preview" />}
            {optimizing && <div className="edit-optimizing"><div className="spinner sm" /> Optimizing preview…</div>}
          </div>
          <div className="edit-transport">
            <button onClick={togglePlayback} aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause size={17} /> : <Play size={17} />}</button>
            <span>{fmtMs(playhead)} <i>/</i> {fmtMs(duration)}</span>
            <input type="range" min={0} max={Math.max(0.001, duration)} step={0.001} value={playhead} onChange={(event) => seekEdited(Number(event.target.value), false)} />
            <label className="edit-overlay-toggle"><Captions size={14} /><input type="checkbox" checked={showOverlays} onChange={(event) => setShowOverlays(event.target.checked)} /> Show captions and logo</label>
          </div>
        </div>

        <aside className="edit-transcript">
          <div className="edit-panel-head">
            <div><strong>Transcript</strong><span>Click to seek · Shift-click to select</span></div>
            <CopyButton
              className="edit-copy-transcript"
              text={formatTranscriptText(editedTranscript, "readable")}
              label="Copy full transcript"
              copiedLabel="Copied"
              disabled={!editedTranscript?.words.length}
            />
          </div>
          <div className="edit-phrase-list">
            {phrases.length ? phrases.map((phrase, index) => {
              const selected = selectedPhraseRange && index >= selectedPhraseRange[0] && index <= selectedPhraseRange[1];
              const active = playhead >= phrase.start && playhead < phrase.end;
              return (
                <button
                  key={phrase.id}
                  className={`edit-phrase ${selected ? "selected" : ""} ${active ? "active" : ""}`}
                  onClick={(event) => {
                    seekEdited(phrase.start, false);
                    setPhraseSelection((previous) => event.shiftKey && previous
                      ? { anchor: previous.anchor, focus: index }
                      : { anchor: index, focus: index });
                  }}
                >
                  <time>{fmtMs(phrase.start)}</time>
                  <div><b>{phrase.speaker || "Speaker"}</b><p>{phrase.text}</p></div>
                </button>
              );
            }) : <div className="edit-empty-transcript">No timed words are available.</div>}
          </div>
          <button className="edit-remove-phrases" onClick={deleteSelection} disabled={!phraseSelection}><Trash2 size={14} /> Remove selected{selectedPhraseRange ? ` (${selectedPhraseRange[1] - selectedPhraseRange[0] + 1})` : ""}</button>
        </aside>
      </section>

      <section className="edit-timeline-shell">
        <div className="edit-toolbar">
          <div className="edit-toolbar-primary">
            <button onClick={splitAtPlayhead} disabled={!canSplit}><Scissors size={15} /> Split <kbd>S</kbd></button>
            <button onClick={deleteSelection} disabled={!range && !selectedSegmentId && !phraseSelection}><Trash2 size={15} /> Delete <kbd>⌫</kbd></button>
            <button onClick={() => void applyOperation({ type: "undo" })}><Undo2 size={15} /> Undo <kbd>⌘Z</kbd></button>
            <button onClick={() => void applyOperation({ type: "redo" })}><Redo2 size={15} /> Redo</button>
            <button onClick={findSilences} disabled={Boolean(silenceStatus) || !project.source.has_audio} title={project.source.has_audio ? undefined : "This source has no audio track"}><Volume2 size={15} /> {silenceStatus || "Find silences"}</button>
          </div>
          <div className="edit-zoom"><ZoomOut size={14} /><input aria-label="Timeline zoom" type="range" min={0.25} max={80} step={0.25} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /><ZoomIn size={14} /><button type="button" onClick={() => setZoom(Math.max(0.25, Math.min(80, timelineViewportWidth / Math.max(duration, 0.001))))}>Fit</button><span>{duration * zoom <= timelineViewportWidth + 1 ? "Full episode" : `${zoom.toFixed(zoom < 10 ? 1 : 0)}px/s`}</span></div>
        </div>
        <div className="edit-timeline-scroll" ref={timelineScrollRef}>
          <div className="edit-timeline" style={{ width: timelineWidth }} ref={timelineRef}>
            <div className="edit-ruler" onPointerDown={beginScrub} title="Click or drag to seek">
              {Array.from({ length: Math.floor(duration / Math.max(5, Math.round(80 / zoom))) + 1 }, (_, index) => {
                const step = Math.max(5, Math.round(80 / timelineScale));
                const time = index * step;
                return <span key={time} style={{ left: `${(time / Math.max(duration, 0.001)) * 100}%` }}>{fmtMs(time).replace(/\.000$/, "")}</span>;
              })}
            </div>
            <div
              className="edit-segments-row"
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (dragSegment.current) void applyOperation({ type: "reorder", segment_id: dragSegment.current, before_segment_id: null });
                dragSegment.current = null;
              }}
            >
              {positions.map((positioned) => {
                const selected = selectedSegmentId === positioned.id;
                const draft = trimDraft?.id === positioned.id ? trimDraft : null;
                const sourceStart = draft?.edge === "start" ? draft.sourceTime : positioned.source_start;
                const sourceEnd = draft?.edge === "end" ? draft.sourceTime : positioned.source_end;
                const width = Math.max(2, (sourceEnd - sourceStart) * timelineScale);
                return (
                  <div
                    key={positioned.id}
                    className={`edit-segment ${selected ? "selected" : ""}`}
                    style={{ width }}
                    draggable
                    onDragStart={(event) => { dragSegment.current = positioned.id; event.dataTransfer.effectAllowed = "move"; }}
                    onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }}
                    onDrop={(event) => {
                      event.preventDefault(); event.stopPropagation();
                      if (dragSegment.current && dragSegment.current !== positioned.id) void applyOperation({ type: "reorder", segment_id: dragSegment.current, before_segment_id: positioned.id });
                      dragSegment.current = null;
                    }}
                    onClick={(event) => { event.stopPropagation(); setSelectedSegmentId(positioned.id); setRange(null); }}
                  >
                    {previewAssets.storyboard && <div className="edit-storyboard-slice" style={{ backgroundImage: `url(${previewAssets.storyboard})`, backgroundSize: `${Math.max(project.source.duration * timelineScale, width)}px 100%`, backgroundPosition: `${-sourceStart * timelineScale}px center` }} />}
                    <span>{fmtMs(sourceStart)}–{fmtMs(sourceEnd)}</span>
                    {selected && <>
                      <button className="edit-trim-handle start" onPointerDown={(event) => startTrim(event, positioned, "start")} aria-label="Trim start" />
                      <button className="edit-trim-handle end" onPointerDown={(event) => startTrim(event, positioned, "end")} aria-label="Trim end" />
                    </>}
                  </div>
                );
              })}
              {!project.timeline.length && <div className="edit-empty-timeline">Timeline is empty. Undo to recover the episode.</div>}
            </div>
            <div
              className="edit-waveform"
              onPointerDown={beginRange}
              onPointerMove={moveRange}
              onPointerUp={endRange}
              onPointerCancel={endRange}
            >
              {previewAssets.waveform ? positions.map((segment) => (
                <div key={segment.id} className="edit-waveform-slice" style={{ width: `${(segment.source_end - segment.source_start) * timelineScale}px`, backgroundImage: `url(${previewAssets.waveform})`, backgroundSize: `${project.source.duration * timelineScale}px 70px`, backgroundPosition: `${-segment.source_start * timelineScale}px center` }} />
              )) : <span>Waveform is preparing in the background…</span>}
            </div>
            {range && <div className="edit-range-selection" style={{ left: `${(Math.min(range.start, range.end) / Math.max(duration, 0.001)) * 100}%`, width: `${(Math.abs(range.end - range.start) / Math.max(duration, 0.001)) * 100}%` }} />}
            {silence?.removed_ranges.flatMap((removed, rangeIndex) => positions.map((segment) => {
              const sourceStart = Math.max(removed.start, segment.source_start);
              const sourceEnd = Math.min(removed.end, segment.source_end);
              if (sourceEnd <= sourceStart) return null;
              const timelineStart = segment.timeline_start + sourceStart - segment.source_start;
              return <div key={`${rangeIndex}-${segment.id}`} className="edit-silence-range" style={{ left: `${(timelineStart / Math.max(duration, 0.001)) * 100}%`, width: `${((sourceEnd - sourceStart) / Math.max(duration, 0.001)) * 100}%` }} />;
            }))}
            <button
              className={`edit-playhead ${playheadX > timelineWidth - 110 ? "near-end" : ""}`}
              style={{
                left: playheadLeft,
                "--playhead-line-x": `${playheadLineX}px`,
                "--playhead-marker-x": `${playheadMarkerX}px`,
              } as React.CSSProperties}
              onPointerDown={beginScrub}
              aria-label={`Drag the orange playhead from ${fmtMs(playhead)}`}
              title="Grab the orange handle and drag to scrub"
            ><span>{fmtMs(playhead)}</span></button>
          </div>
        </div>
        <footer className="edit-timeline-footer">
          <span>Original {fmtMs(project.source.duration)}</span><span>Edited {fmtMs(duration)}</span><span>Removed {fmtMs(Math.max(0, project.source.duration - duration))}</span><span className="edit-scrub-hint">Drag orange handle to scrub</span>
          <span className="spacer" />
          {timelineIsUnchanged && <button className="edit-skip" onClick={useEditedEpisode}>Skip editing and continue to clips</button>}
        </footer>
      </section>
    </div>
  );
}
