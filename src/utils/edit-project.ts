import type {
  SpeakerSegment,
  TimelineSegment,
  TranscriptResult,
  TranscriptSegment,
  WordTimestamp,
} from "../models/index.js";

export const MIN_SEGMENT_DURATION = 0.04;
const EPSILON = 0.0005;

export interface PositionedTimelineSegment extends TimelineSegment {
  timeline_start: number;
  timeline_end: number;
}

export interface PhraseBlock {
  id: string;
  start: number;
  end: number;
  text: string;
  speaker?: string | null;
  word_start: number;
  word_end: number;
}

export interface EditedClipRangeInput {
  start_second: number;
  end_second: number;
  segments?: Array<{ start: number; end: number }>;
  keep_segments?: Array<{ start: number; end: number }>;
}

export function seconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function validateTimeline(
  timeline: TimelineSegment[],
  sourceDuration = Number.POSITIVE_INFINITY,
): TimelineSegment[] {
  if (!Array.isArray(timeline)) throw new Error("Timeline must be an array");
  const ids = new Set<string>();
  return timeline.map((segment) => {
    if (!segment || typeof segment.id !== "string" || !segment.id.trim()) {
      throw new Error("Every timeline segment needs an id");
    }
    if (ids.has(segment.id)) throw new Error(`Duplicate segment id: ${segment.id}`);
    ids.add(segment.id);
    if (!Number.isFinite(segment.source_start) || !Number.isFinite(segment.source_end)) {
      throw new Error(`Segment ${segment.id} has invalid timestamps`);
    }
    const start = seconds(segment.source_start);
    const end = seconds(segment.source_end);
    if (start < 0 || end > sourceDuration + EPSILON || end - start < MIN_SEGMENT_DURATION - EPSILON) {
      throw new Error(`Segment ${segment.id} is outside the source or shorter than 40 ms`);
    }
    return { id: segment.id, source_start: start, source_end: end };
  });
}

export function positionTimeline(timeline: TimelineSegment[]): PositionedTimelineSegment[] {
  let cursor = 0;
  return timeline.map((segment) => {
    const duration = segment.source_end - segment.source_start;
    const positioned = {
      ...segment,
      timeline_start: seconds(cursor),
      timeline_end: seconds(cursor + duration),
    };
    cursor += duration;
    return positioned;
  });
}

export function editedDuration(timeline: TimelineSegment[]): number {
  return seconds(timeline.reduce((total, segment) => total + segment.source_end - segment.source_start, 0));
}

export function timelineStats(sourceDuration: number, timeline: TimelineSegment[]) {
  const edited = editedDuration(timeline);
  return {
    original_duration: seconds(sourceDuration),
    edited_duration: edited,
    removed_duration: seconds(Math.max(0, sourceDuration - edited)),
  };
}

export function splitSegment(
  timeline: TimelineSegment[],
  segmentId: string,
  sourceTime: number,
  makeId: () => string = defaultId,
): TimelineSegment[] {
  const index = timeline.findIndex((segment) => segment.id === segmentId);
  if (index < 0) throw new Error("Segment not found");
  const segment = timeline[index];
  const point = seconds(sourceTime);
  if (
    point - segment.source_start < MIN_SEGMENT_DURATION - EPSILON ||
    segment.source_end - point < MIN_SEGMENT_DURATION - EPSILON
  ) {
    throw new Error("Split must leave at least 40 ms on each side");
  }
  return [
    ...timeline.slice(0, index),
    { ...segment, source_end: point },
    { id: makeId(), source_start: point, source_end: segment.source_end },
    ...timeline.slice(index + 1),
  ];
}

export function trimSegment(
  timeline: TimelineSegment[],
  segmentId: string,
  edge: "start" | "end",
  sourceTime: number,
): TimelineSegment[] {
  const index = timeline.findIndex((segment) => segment.id === segmentId);
  if (index < 0) throw new Error("Segment not found");
  const next = [...timeline];
  const segment = next[index];
  const point = seconds(sourceTime);
  const trimmed = edge === "start"
    ? { ...segment, source_start: point }
    : { ...segment, source_end: point };
  if (trimmed.source_start < 0 || trimmed.source_end - trimmed.source_start < MIN_SEGMENT_DURATION - EPSILON) {
    throw new Error("Trim must leave a segment of at least 40 ms");
  }
  next[index] = trimmed;
  return next;
}

export function deleteTimelineRange(
  timeline: TimelineSegment[],
  timelineStart: number,
  timelineEnd: number,
  makeId: () => string = defaultId,
): TimelineSegment[] {
  const total = editedDuration(timeline);
  const start = Math.max(0, Math.min(total, seconds(Math.min(timelineStart, timelineEnd))));
  const end = Math.max(0, Math.min(total, seconds(Math.max(timelineStart, timelineEnd))));
  if (end - start < EPSILON) throw new Error("Select a non-empty range to delete");

  const next: TimelineSegment[] = [];
  for (const positioned of positionTimeline(timeline)) {
    if (end <= positioned.timeline_start + EPSILON || start >= positioned.timeline_end - EPSILON) {
      next.push(stripPosition(positioned));
      continue;
    }
    const leftDuration = Math.max(0, start - positioned.timeline_start);
    const rightDuration = Math.max(0, positioned.timeline_end - end);
    if (leftDuration >= MIN_SEGMENT_DURATION - EPSILON) {
      next.push({
        id: positioned.id,
        source_start: positioned.source_start,
        source_end: seconds(positioned.source_start + leftDuration),
      });
    }
    if (rightDuration >= MIN_SEGMENT_DURATION - EPSILON) {
      next.push({
        id: leftDuration >= MIN_SEGMENT_DURATION - EPSILON ? makeId() : positioned.id,
        source_start: seconds(positioned.source_end - rightDuration),
        source_end: positioned.source_end,
      });
    }
  }
  return next;
}

export function reorderSegment(
  timeline: TimelineSegment[],
  segmentId: string,
  beforeSegmentId: string | null,
): TimelineSegment[] {
  const from = timeline.findIndex((segment) => segment.id === segmentId);
  if (from < 0) throw new Error("Segment not found");
  if (beforeSegmentId === segmentId) return [...timeline];
  const next = [...timeline];
  const [moving] = next.splice(from, 1);
  if (beforeSegmentId === null) return [...next, moving];
  const target = next.findIndex((segment) => segment.id === beforeSegmentId);
  if (target < 0) throw new Error("Reorder target not found");
  next.splice(target, 0, moving);
  return next;
}

export function mapEditedTimeToSource(
  timeline: TimelineSegment[],
  editedTime: number,
): { segment_id: string; source_time: number; segment_index: number } | null {
  const positioned = positionTimeline(timeline);
  if (!positioned.length) return null;
  const total = positioned[positioned.length - 1].timeline_end;
  const time = Math.max(0, Math.min(total, editedTime));
  let index = positioned.findIndex((segment) => time < segment.timeline_end - EPSILON);
  if (index < 0) index = positioned.length - 1;
  const segment = positioned[index];
  return {
    segment_id: segment.id,
    segment_index: index,
    source_time: seconds(segment.source_start + Math.max(0, time - segment.timeline_start)),
  };
}

export function mapEditedRangeToSource(
  timeline: TimelineSegment[],
  timelineStart: number,
  timelineEnd: number,
): Array<{ start: number; end: number }> {
  const start = Math.max(0, Math.min(timelineStart, timelineEnd));
  const end = Math.min(editedDuration(timeline), Math.max(timelineStart, timelineEnd));
  if (end - start < EPSILON) return [];
  const slices: Array<{ start: number; end: number }> = [];
  for (const segment of positionTimeline(timeline)) {
    const overlapStart = Math.max(start, segment.timeline_start);
    const overlapEnd = Math.min(end, segment.timeline_end);
    if (overlapEnd - overlapStart < EPSILON) continue;
    slices.push({
      start: seconds(segment.source_start + overlapStart - segment.timeline_start),
      end: seconds(segment.source_start + overlapEnd - segment.timeline_start),
    });
  }
  return slices;
}

/** Convert one clip's edited-time selection into ordered source slices. */
export function mapEditedClipToSource(
  timeline: TimelineSegment[],
  clip: EditedClipRangeInput,
): Array<{ start: number; end: number }> {
  const ranges = clip.segments?.length
    ? clip.segments
    : clip.keep_segments?.length
      ? clip.keep_segments
      : [{ start: clip.start_second, end: clip.end_second }];
  return ranges.flatMap((range) => {
    const start = Number(range.start);
    const end = Number(range.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new Error("Clip has an invalid edited range");
    }
    return mapEditedRangeToSource(timeline, start, end);
  });
}

export function retainSourceRanges(
  timeline: TimelineSegment[],
  chronologicalKeepRanges: Array<{ start: number; end: number }>,
  makeId: () => string = defaultId,
): TimelineSegment[] {
  const ranges = [...chronologicalKeepRanges]
    .filter((range) => range.end - range.start >= MIN_SEGMENT_DURATION - EPSILON)
    .sort((a, b) => a.start - b.start);
  const rangeMaxEnds = prefixMaxEnds(ranges);
  const next: TimelineSegment[] = [];
  for (const segment of timeline) {
    let occurrence = 0;
    for (let index = lowerBoundMaxEnd(rangeMaxEnds, segment.source_start); index < ranges.length; index += 1) {
      const range = ranges[index];
      if (range.start >= segment.source_end) break;
      const start = Math.max(segment.source_start, range.start);
      const end = Math.min(segment.source_end, range.end);
      if (end - start < MIN_SEGMENT_DURATION - EPSILON) continue;
      next.push({
        id: occurrence++ === 0 ? segment.id : makeId(),
        source_start: seconds(start),
        source_end: seconds(end),
      });
    }
  }
  return next;
}

export function remapTranscript(source: TranscriptResult, timeline: TimelineSegment[]): TranscriptResult {
  const words = remapWords(source.words ?? [], timeline);
  const segments = rebuildTranscriptSegments(words);
  const speakerSegments = rebuildSpeakerSegments(words);
  const speakers: TranscriptResult["speakers"] = { num_speakers: 0, speakers: {} };
  for (const word of words) {
    const speaker = word.speaker ?? "Speaker";
    const current = speakers.speakers[speaker] ?? { total_time: 0, segments: 0, label: speaker };
    current.total_time = seconds(current.total_time + Math.max(0, word.end - word.start));
    speakers.speakers[speaker] = current;
  }
  for (const segment of speakerSegments) {
    const current = speakers.speakers[segment.speaker];
    if (current) current.segments += 1;
  }
  speakers.num_speakers = Object.keys(speakers.speakers).length;
  return {
    ...source,
    transcript: wordsToText(words),
    words,
    segments,
    duration: editedDuration(timeline),
    speakers,
    speaker_segments: speakerSegments,
  };
}

export function remapWords(words: WordTimestamp[], timeline: TimelineSegment[]): WordTimestamp[] {
  const output: WordTimestamp[] = [];
  const chronological = words.every((word, index) => index === 0 || words[index - 1].start <= word.start)
    ? words
    : [...words].sort((a, b) => a.start - b.start || a.end - b.end);
  const wordMaxEnds = prefixMaxEnds(chronological);
  for (const segment of positionTimeline(timeline)) {
    for (let index = lowerBoundMaxEnd(wordMaxEnds, segment.source_start); index < chronological.length; index += 1) {
      const word = chronological[index];
      if (word.start >= segment.source_end) break;
      const sourceStart = Math.max(word.start, segment.source_start);
      const sourceEnd = Math.min(word.end, segment.source_end);
      if (sourceEnd - sourceStart <= EPSILON) continue;
      output.push({
        ...word,
        start: seconds(segment.timeline_start + sourceStart - segment.source_start),
        end: seconds(segment.timeline_start + sourceEnd - segment.source_start),
      });
    }
  }
  return output;
}

function prefixMaxEnds(items: Array<{ end: number }>): number[] {
  const output: number[] = [];
  let maximum = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    maximum = Math.max(maximum, item.end);
    output.push(maximum);
  }
  return output;
}

function lowerBoundMaxEnd(maxEnds: number[], sourceStart: number): number {
  let low = 0;
  let high = maxEnds.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (maxEnds[mid] <= sourceStart + EPSILON) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function buildPhraseBlocks(words: WordTimestamp[]): PhraseBlock[] {
  if (!words.length) return [];
  const blocks: PhraseBlock[] = [];
  let startIndex = 0;
  const flush = (endIndex: number) => {
    const slice = words.slice(startIndex, endIndex + 1);
    if (!slice.length) return;
    blocks.push({
      id: `phrase-${startIndex}-${endIndex}`,
      start: slice[0].start,
      end: slice[slice.length - 1].end,
      text: wordsToText(slice),
      speaker: slice[0].speaker,
      word_start: startIndex,
      word_end: endIndex,
    });
    startIndex = endIndex + 1;
  };
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (index > startIndex && word.end - words[startIndex].start > 12) {
      flush(index - 1);
    }
    const next = words[index + 1];
    const duration = word.end - words[startIndex].start;
    const sentenceEnd = /[.!?][”'\"]?$/.test(word.word.trim());
    const speakerChange = Boolean(next && next.speaker !== word.speaker);
    const pause = Boolean(next && next.start - word.end >= 0.6);
    if (!next || sentenceEnd || speakerChange || pause || duration >= 12) flush(index);
  }
  return blocks;
}

export function phraseSelectionRange(blocks: PhraseBlock[], firstIndex: number, lastIndex: number) {
  const startIndex = Math.max(0, Math.min(firstIndex, lastIndex));
  const endIndex = Math.min(blocks.length - 1, Math.max(firstIndex, lastIndex));
  if (!blocks[startIndex] || !blocks[endIndex]) throw new Error("Phrase selection is empty");
  const previous = blocks[startIndex - 1];
  const next = blocks[endIndex + 1];
  const start = previous
    ? previous.end < blocks[startIndex].start
      ? seconds((previous.end + blocks[startIndex].start) / 2)
      : blocks[startIndex].start
    : blocks[startIndex].start;
  const end = next
    ? blocks[endIndex].end < next.start
      ? seconds((blocks[endIndex].end + next.start) / 2)
      : blocks[endIndex].end
    : blocks[endIndex].end;
  return { start, end };
}

function rebuildTranscriptSegments(words: WordTimestamp[]): TranscriptSegment[] {
  return buildPhraseBlocks(words).map((block, index) => ({
    id: index,
    start: block.start,
    end: block.end,
    text: block.text,
    speaker: block.speaker,
  }));
}

function rebuildSpeakerSegments(words: WordTimestamp[]): SpeakerSegment[] {
  const output: SpeakerSegment[] = [];
  for (const word of words) {
    const speaker = word.speaker ?? "Speaker";
    const previous = output[output.length - 1];
    if (previous && previous.speaker === speaker && word.start - previous.end < 0.6) {
      previous.end = word.end;
    } else {
      output.push({ speaker, start: word.start, end: word.end });
    }
  }
  return output;
}

function wordsToText(words: Array<Pick<WordTimestamp, "word">>): string {
  return words
    .map((word) => word.word.trim())
    .join(" ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function stripPosition(segment: PositionedTimelineSegment): TimelineSegment {
  return { id: segment.id, source_start: segment.source_start, source_end: segment.source_end };
}

function defaultId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `segment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
