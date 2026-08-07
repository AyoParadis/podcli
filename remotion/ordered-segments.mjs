export const orderedDuration = (segments) =>
  segments.reduce((total, segment) => total + segment.end - segment.start, 0);

export const outputSlicePlan = (segments, outputStart, outputEnd) => {
  if (!segments) return [{ start: outputStart, end: outputEnd, fadeIn: false, fadeOut: false }];
  const slices = [];
  const totalDuration = orderedDuration(segments);
  let cursor = 0;
  for (const segment of segments) {
    const length = segment.end - segment.start;
    const segmentOutputEnd = cursor + length;
    const overlapStart = Math.max(outputStart, cursor);
    const overlapEnd = Math.min(outputEnd, segmentOutputEnd);
    if (overlapEnd > overlapStart) {
      slices.push({
        start: segment.start + overlapStart - cursor,
        end: segment.start + overlapEnd - cursor,
        fadeIn: cursor > 0 && Math.abs(overlapStart - cursor) < 0.0005,
        fadeOut: segmentOutputEnd < totalDuration && Math.abs(overlapEnd - segmentOutputEnd) < 0.0005,
      });
    }
    cursor = segmentOutputEnd;
    if (cursor >= outputEnd) break;
  }
  return slices;
};

export const outputSlices = (segments, outputStart, outputEnd) =>
  outputSlicePlan(segments, outputStart, outputEnd).map(({ start, end }) => ({ start, end }));
