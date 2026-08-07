import { describe, expect, it } from "vitest";
import { orderedDuration, outputSlicePlan, outputSlices } from "./ordered-segments.mjs";

describe("ordered full episode slices", () => {
  const reordered = [
    { start: 20, end: 25 },
    { start: 0, end: 10 },
    { start: 20, end: 25 },
  ];

  it("preserves reorder and duplicate occurrences", () => {
    expect(orderedDuration(reordered)).toBe(20);
    expect(outputSlices(reordered, 3, 18)).toEqual([
      { start: 23, end: 25 },
      { start: 0, end: 10 },
      { start: 20, end: 23 },
    ]);
  });

  it("maps chunk boundaries inside source slices", () => {
    expect(outputSlices(reordered, 6, 12)).toEqual([{ start: 1, end: 7 }]);
  });

  it("keeps chronological behavior without an edit project", () => {
    expect(outputSlices(null, 12, 15)).toEqual([{ start: 12, end: 15 }]);
  });

  it("marks project cuts even when they land exactly on render chunk boundaries", () => {
    const segments = [{ start: 0, end: 15 }, { start: 30, end: 45 }];
    expect(outputSlicePlan(segments, 0, 15)).toEqual([
      { start: 0, end: 15, fadeIn: false, fadeOut: true },
    ]);
    expect(outputSlicePlan(segments, 15, 30)).toEqual([
      { start: 30, end: 45, fadeIn: true, fadeOut: false },
    ]);
  });

  it("does not fade ordinary renderer chunk boundaries inside one source segment", () => {
    expect(outputSlicePlan([{ start: 0, end: 30 }], 0, 15)[0]).toMatchObject({ fadeIn: false, fadeOut: false });
    expect(outputSlicePlan([{ start: 0, end: 30 }], 15, 30)[0]).toMatchObject({ fadeIn: false, fadeOut: false });
  });
});
