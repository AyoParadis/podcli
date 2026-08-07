import { describe, expect, it } from "vitest";
import type { TimelineSegment, TranscriptResult } from "../models/index.js";
import {
  buildPhraseBlocks,
  deleteTimelineRange,
  editedDuration,
  mapEditedClipToSource,
  mapEditedRangeToSource,
  phraseSelectionRange,
  remapTranscript,
  reorderSegment,
  retainSourceRanges,
  splitSegment,
  trimSegment,
  validateTimeline,
} from "./edit-project.js";

const segment = (id: string, start: number, end: number): TimelineSegment => ({
  id,
  source_start: start,
  source_end: end,
});

describe("edit project timeline", () => {
  it("splits and trims without merging intentional boundaries", () => {
    const split = splitSegment([segment("a", 0, 10)], "a", 4, () => "b");
    expect(split).toEqual([segment("a", 0, 4), segment("b", 4, 10)]);
    expect(trimSegment(split, "b", "start", 5)).toEqual([segment("a", 0, 4), segment("b", 5, 10)]);
  });

  it("ripple deletes across multiple segments", () => {
    const timeline = [segment("a", 0, 5), segment("b", 10, 15), segment("c", 20, 25)];
    const result = deleteTimelineRange(timeline, 3, 12, () => "right");
    expect(result).toEqual([segment("a", 0, 3), segment("c", 22, 25)]);
    expect(editedDuration(result)).toBe(6);
  });

  it("preserves reordered and repeated source ranges", () => {
    const timeline = [segment("a", 0, 5), segment("b", 10, 15), segment("copy", 0, 5)];
    expect(reorderSegment(timeline, "b", "a")).toEqual([
      segment("b", 10, 15),
      segment("a", 0, 5),
      segment("copy", 0, 5),
    ]);
    expect(mapEditedRangeToSource(reorderSegment(timeline, "b", "a"), 3, 12)).toEqual([
      { start: 13, end: 15 },
      { start: 0, end: 5 },
      { start: 0, end: 2 },
    ]);
  });

  it("maps clip segments through one shared ordered-range path", () => {
    const timeline = [segment("late", 10, 15), segment("early", 0, 5)];
    expect(mapEditedClipToSource(timeline, {
      start_second: 0,
      end_second: 10,
      segments: [{ start: 3, end: 7 }],
    })).toEqual([{ start: 13, end: 15 }, { start: 0, end: 2 }]);
    expect(() => mapEditedClipToSource(timeline, {
      start_second: 0,
      end_second: 10,
      keep_segments: [{ start: 4, end: 3 }],
    })).toThrow(/invalid edited range/);
  });

  it("intersects silence keep ranges per timeline occurrence", () => {
    const result = retainSourceRanges(
      [segment("late", 10, 20), segment("early", 0, 10), segment("repeat", 10, 20)],
      [{ start: 2, end: 4 }, { start: 12, end: 14 }],
      () => "new",
    );
    expect(result).toEqual([
      segment("late", 12, 14),
      segment("early", 2, 4),
      segment("repeat", 12, 14),
    ]);
  });

  it("rejects invalid segments but never sorts valid input", () => {
    const timeline = [segment("later", 9, 10), segment("earlier", 0, 1)];
    expect(validateTimeline(timeline, 10)).toEqual(timeline);
    expect(() => validateTimeline([segment("tiny", 0, 0.02)], 10)).toThrow(/40 ms/);
  });
});

describe("edited transcript", () => {
  const transcript: TranscriptResult = {
    transcript: "one two three four",
    duration: 10,
    language: "en",
    segments: [],
    words: [
      { word: "one", start: 0, end: 1, confidence: 1, speaker: "A" },
      { word: "two.", start: 1.1, end: 2, confidence: 1, speaker: "A" },
      { word: "three", start: 5, end: 6, confidence: 1, speaker: "B" },
      { word: "four.", start: 6.7, end: 7.2, confidence: 1, speaker: "B" },
    ],
    speakers: { num_speakers: 2, speakers: {} },
    speaker_segments: [],
  };

  it("clones words for repeated ranges and rebuilds speaker blocks", () => {
    const edited = remapTranscript(transcript, [segment("b", 5, 8), segment("a", 0, 3), segment("again", 5, 8)]);
    expect(edited.words.map((word) => word.word)).toEqual(["three", "four.", "one", "two.", "three", "four."]);
    expect(edited.words[2].start).toBe(3);
    expect(edited.speaker_segments.map((item) => item.speaker)).toEqual(["B", "B", "A", "B", "B"]);
  });

  it("clamps a word that crosses both cut boundaries", () => {
    const crossing: TranscriptResult = {
      ...transcript,
      transcript: "crossing",
      words: [{ word: "crossing", start: 1, end: 4, confidence: 1, speaker: "A" }],
    };
    const edited = remapTranscript(crossing, [segment("middle", 2, 3)]);
    expect(edited.words).toEqual([
      { word: "crossing", start: 0, end: 1, confidence: 1, speaker: "A" },
    ]);
  });

  it("maps 5,000 repeated timeline occurrences without losing order", () => {
    const timeline = Array.from({ length: 5_000 }, (_, index) => segment(`repeat-${index}`, 0, 0.5));
    const repeated = remapTranscript({
      ...transcript,
      words: [{ word: "again", start: 0.1, end: 0.2, confidence: 1, speaker: "A" }],
    }, timeline);
    expect(repeated.words).toHaveLength(5_000);
    expect(repeated.words[0].start).toBe(0.1);
    expect(repeated.words.at(-1)?.start).toBe(2_499.6);
  });

  it("makes phrases on punctuation, speakers, pauses, and duration", () => {
    const blocks = buildPhraseBlocks(transcript.words);
    expect(blocks.map((block) => block.text)).toEqual(["one two.", "three", "four."]);
  });

  it("keeps every multi-word phrase within 12 seconds", () => {
    const words = Array.from({ length: 14 }, (_, index) => ({
      word: `w${index}`,
      start: index,
      end: index + 0.8,
      confidence: 1,
      speaker: "A",
    }));
    const blocks = buildPhraseBlocks(words);
    expect(blocks.every((block) => block.end - block.start <= 12)).toBe(true);
    expect(blocks.map((block) => block.text)).toEqual([
      "w0 w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 w11",
      "w12 w13",
    ]);
  });

  it("uses gap midpoints and exact word edges when phrases overlap", () => {
    const blocks = buildPhraseBlocks([
      { word: "before.", start: 0, end: 1, confidence: 1, speaker: "A" },
      { word: "selected.", start: 2, end: 3, confidence: 1, speaker: "A" },
      { word: "overlap", start: 2.9, end: 4, confidence: 1, speaker: "A" },
    ]);
    expect(phraseSelectionRange(blocks, 1, 1)).toEqual({ start: 1.5, end: 3 });
  });
});
