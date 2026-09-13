import { splitIntoSentences } from "@drive-coding/core/voice/sentence-boundary"
import type { SpeakablePart } from "@drive-coding/core/voice/speakable"

export type InlineAudioQueueItem =
  | { kind: "text"; text: string }
  | { kind: "file"; file: Extract<SpeakablePart, { kind: "file" }> }

export type InlineAudioQueueOpts = {
  minChars: number
  maxChars: number
  autoPlayInlineAudio: boolean
}

type PendingState = { speakPending: string }

/** Apply one speakableParts chunk — mutates pending, returns enqueue actions. */
export function drainSpeakablePartsChunk(
  parts: SpeakablePart[],
  state: PendingState,
  opts: InlineAudioQueueOpts,
): InlineAudioQueueItem[] {
  const out: InlineAudioQueueItem[] = []
  for (const part of parts) {
    if (part.kind === "text") {
      state.speakPending += part.text
      const { sentences, remaining } = splitIntoSentences(state.speakPending, {
        minChars: opts.minChars,
        maxChars: opts.maxChars,
      })
      state.speakPending = remaining
      for (const sentence of sentences) out.push({ kind: "text", text: sentence })
    } else {
      const flushed = state.speakPending.trim()
      state.speakPending = ""
      if (flushed.length > 0) out.push({ kind: "text", text: flushed })
      if (opts.autoPlayInlineAudio) out.push({ kind: "file", file: part })
    }
  }
  return out
}

/** Full bubble text → playback queue (BubblePlayer). */
export function buildInlineAudioQueue(
  parts: SpeakablePart[],
  opts: InlineAudioQueueOpts,
): InlineAudioQueueItem[] {
  const state: PendingState = { speakPending: "" }
  const queue = drainSpeakablePartsChunk(parts, state, opts)
  const tail = state.speakPending.trim()
  if (tail.length > 0) {
    if (queue.length > 1) {
      const last = queue[queue.length - 1]
      if (last?.kind === "text" && tail.length < opts.minChars) {
        last.text = `${last.text} ${tail}`
      } else {
        queue.push({ kind: "text", text: tail })
      }
    } else {
      queue.push({ kind: "text", text: tail })
    }
  }
  if (queue.length === 0 && parts.length > 0) {
    const onlyText = parts
      .filter((p) => p.kind === "text")
      .map((p) => (p as { kind: "text"; text: string }).text)
      .join("")
      .trim()
    if (onlyText.length > 0) queue.push({ kind: "text", text: onlyText })
  }
  return queue
}
