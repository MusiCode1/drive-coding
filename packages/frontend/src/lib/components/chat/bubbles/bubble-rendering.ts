import type { Segment, ThoughtSegment, ToolBubble } from "$lib/types/bubble"

export function joinSegmentText(segments: Segment[]): string {
  return segments.map((seg) => seg.text).join("")
}

export function visibleThoughtSegments<T extends ThoughtSegment>(segments: T[]): T[] {
  const translated = segments.filter((seg) => seg.originalText !== undefined)
  return translated.length > 0 ? translated : segments
}

/**
 * isSubagentTask — סמן-זיהוי Task-bubble (slice subagent-transcript-render, B2).
 *
 * B1 קובע `toolCall.task` על task_started, ו-`subFrames` נבנה lazily על ה-frame
 * הראשון של התעתיק. סמן משולב תופס את ה-Task ברגע שאחד מהשניים מאוכלס
 * (task קודם, בדרך-כלל) — subFrames לבדו שביר (מחמיץ Task שקיבל רק task_started).
 */
export function isSubagentTask(bubble: ToolBubble): boolean {
  return bubble.toolCall.task !== undefined || bubble.subFrames !== undefined
}
