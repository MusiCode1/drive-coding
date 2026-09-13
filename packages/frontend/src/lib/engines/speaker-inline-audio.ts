import type { AudioEmbedRef } from "@drive-coding/core/voice/audio-embed"
import type { OrderKey } from "@drive-coding/core/voice/tts-queue"
import type { SpeakableLabels } from "@drive-coding/core/voice/speakable"
import { toSpeakableParts } from "@drive-coding/core/voice/speakable"
import { drainSpeakablePartsChunk } from "./inline-audio-queue"

export type SpeakerBubbleState = {
  speakPending: string
}

export type SpeakerEnqueueCtx = {
  labels: SpeakableLabels
  cwd: string | null
  minChars: number
  maxChars: number
  autoPlayInlineAudio: boolean
  enqueueText: (text: string) => void
  enqueueFile: (file: AudioEmbedRef) => void
}

export function ingestSpeakerSpeakableChunk(
  state: SpeakerBubbleState,
  raw: string,
  ctx: SpeakerEnqueueCtx,
): void {
  const parts = toSpeakableParts(raw, ctx.labels, { stream: true, cwd: ctx.cwd })
  const items = drainSpeakablePartsChunk(parts, state, {
    minChars: ctx.minChars,
    maxChars: ctx.maxChars,
    autoPlayInlineAudio: ctx.autoPlayInlineAudio,
  })
  for (const item of items) {
    if (item.kind === "text") ctx.enqueueText(item.text)
    else ctx.enqueueFile(item.file)
  }
}

export type FileTtsJobDraft = {
  segmentId: string
  kind: "file"
  messageId: string | null
  text: string
  file: AudioEmbedRef
  bubbleId: string
  orderKey: OrderKey
}

export function draftFileTtsJob(
  file: AudioEmbedRef,
  messageId: string | null,
  bubbleId: string,
  orderKey: OrderKey,
  newId: () => string,
): FileTtsJobDraft {
  return {
    segmentId: newId(),
    kind: "file",
    messageId,
    text: file.title,
    file,
    bubbleId,
    orderKey,
  }
}

export type FileJobSink = {
  pushJob: (draft: FileTtsJobDraft & { status: "pending"; abort: AbortController }) => void
  reserve: (segmentId: string, orderKey: OrderKey, bubbleId: string) => void
  bumpPending: () => void
  noteRecent: (title: string, bubbleId: string) => void
}

export function enqueueSpeakerFileJob(
  file: AudioEmbedRef,
  messageId: string | null,
  bubbleId: string,
  orderKey: OrderKey,
  newId: () => string,
  sink: FileJobSink,
): void {
  const draft = draftFileTtsJob(file, messageId, bubbleId, orderKey, newId)
  sink.pushJob({ ...draft, status: "pending", abort: new AbortController() })
  sink.reserve(draft.segmentId, orderKey, bubbleId)
  sink.bumpPending()
  sink.noteRecent(file.title, bubbleId)
}
