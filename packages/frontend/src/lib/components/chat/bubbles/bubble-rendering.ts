import type { Segment, ThoughtSegment } from "$lib/types/bubble"

export function joinSegmentText(segments: Segment[]): string {
  return segments.map((seg) => seg.text).join("")
}

export function visibleThoughtSegments<T extends ThoughtSegment>(segments: T[]): T[] {
  const translated = segments.filter((seg) => seg.originalText !== undefined)
  return translated.length > 0 ? translated : segments
}
