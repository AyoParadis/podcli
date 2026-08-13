export function maxClipSeconds(format?: string): number {
  return format === "horizontal" ? 300 : 180;
}

export const MIN_STRONG_SUGGESTION_SCORE = 15;

/** Maximum number of non-overlapping clips that can physically fit. */
export function suggestionCapacity(
  segments: Array<{ start?: number; end?: number }>,
  minDuration: number,
): number {
  const starts = segments.map((segment) => segment.start).filter((value): value is number => Number.isFinite(value));
  const ends = segments.map((segment) => segment.end).filter((value): value is number => Number.isFinite(value));
  if (!starts.length || !ends.length) return 1;
  const first = starts.reduce((minimum, value) => Math.min(minimum, value));
  const last = ends.reduce((maximum, value) => Math.max(maximum, value));
  const duration = Math.max(0, last - first);
  return Math.max(1, Math.floor(duration / Math.max(1, minDuration)));
}

/** Returns an error message, or null when the range is renderable. */
export function validateClipRange(
  start: unknown,
  end: unknown,
  format?: string,
): string | null {
  if (
    typeof start !== "number" ||
    !Number.isFinite(start) ||
    typeof end !== "number" ||
    !Number.isFinite(end)
  ) {
    return "start_second and end_second must be numbers";
  }
  if (start < 0) return "start_second must be >= 0";
  if (end <= start) return "end_second must be greater than start_second";
  const maxDur = maxClipSeconds(format);
  if (end - start > maxDur) {
    return `Clip too long (${Math.round(end - start)}s). Max ${maxDur} seconds.`;
  }
  return null;
}

// Suggestions aren't bound to a format yet, so allow up to the longest
// renderable duration plus trim headroom.
const MAX_SUGGESTION_SECONDS = 600;

export function validateSuggestionRange(start: unknown, end: unknown): string | null {
  if (
    typeof start !== "number" ||
    !Number.isFinite(start) ||
    typeof end !== "number" ||
    !Number.isFinite(end)
  ) {
    return "start_second and end_second must be numbers";
  }
  if (start < 0) return "start_second must be >= 0";
  if (end <= start) return "end_second must be greater than start_second";
  if (end - start > MAX_SUGGESTION_SECONDS) {
    return `Suggested range too long (${Math.round(end - start)}s). Max ${MAX_SUGGESTION_SECONDS} seconds.`;
  }
  return null;
}
