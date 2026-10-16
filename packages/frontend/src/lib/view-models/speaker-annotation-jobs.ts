import { DEFAULT_VOICE_CONFIG } from "@drive-coding/core/voice/capabilities"
import type { NarrateContext, ToolCallForNarrate } from "@drive-coding/core/voice/narration-prompt"
import { select } from "@drive-coding/core/voice/select"
import { narrate } from "../adapters/voice/narrate"
import type { TtsJob } from "./speaker.svelte"
import type {
  AnnotationTarget,
  SpeakerTranscriptPort,
  ThoughtSource,
  TranscriptProcessingTarget,
} from "./speaker-transcript-port"

export type AnnotationJobCapture = {
  readonly target: AnnotationTarget
  readonly processingTarget: TranscriptProcessingTarget
  readonly sources?: readonly ThoughtSource[]
  readonly toolKind?: string
}

export class SpeakerAnnotationJobs {
  readonly #port: SpeakerTranscriptPort
  readonly #translated = new WeakMap<TranscriptProcessingTarget, Map<string, number>>()

  constructor(port: SpeakerTranscriptPort) {
    this.#port = port
  }
  capture(job: TtsJob): void {
    const bubble = this.#port.bubbles.find((b) => b.id === job.bubbleId)
    job.annotation = {
      target: this.#port.captureTarget(),
      processingTarget: this.#port.processingTarget,
      toolKind: bubble?.kind === "tool" ? bubble.toolCall.kind : undefined,
      sources:
        bubble?.kind === "thought"
          ? bubble.segments.map((segment) => ({
              id: segment.id,
              originalText: segment.originalText ?? segment.text,
            }))
          : undefined,
    }
  }
  isCurrent(capture: AnnotationJobCapture | undefined): boolean {
    return capture !== undefined && this.#port.isCurrent(capture.target)
  }
  liveAttempt(
    job: TtsJob,
    attempt: AbortController,
    capture: AnnotationJobCapture | undefined,
  ): boolean {
    return job.abort === attempt && !attempt.signal.aborted && this.isCurrent(capture)
  }
  async narrateToolCall(
    job: TtsJob,
    attempt: AbortController,
    capture: AnnotationJobCapture | undefined,
  ): Promise<string | null> {
    if (!this.liveAttempt(job, attempt, capture)) return null
    if (!capture || job.toolCallId === undefined || job.bubbleId === undefined) return null
    const bubble = this.#port.bubbles.find((b) => b.id === job.bubbleId)
    if (
      bubble?.kind !== "tool" ||
      bubble.toolCall.toolCallId !== job.toolCallId ||
      bubble.toolCall.kind !== capture.toolKind
    )
      return null
    const tc = bubble.toolCall
    const ctx: NarrateContext = {
      userMessage: this.#port.lastUserMessage,
      recentMessages: this.#port.recentAssistantMessages(3),
    }
    const tool: ToolCallForNarrate = {
      toolCallId: tc.toolCallId,
      kind: tc.kind,
      title: tc.title ?? tc.name,
    }
    const text = await narrate(ctx, tool, select("narrate", DEFAULT_VOICE_CONFIG), attempt.signal)
    if (text === null || !this.liveAttempt(job, attempt, capture)) return null
    this.#port.writeToolNarration(
      capture.target,
      job.bubbleId,
      job.toolCallId,
      capture.toolKind,
      text,
    )
    return text
  }
  thoughtTranslation(
    job: TtsJob,
    attempt: AbortController,
    capture: AnnotationJobCapture | undefined,
    original: string,
    translated: string,
  ): void {
    if (!capture || !this.liveAttempt(job, attempt, capture) || !job.bubbleId) return
    let counts = this.#translated.get(capture.processingTarget)
    if (!counts) {
      counts = new Map()
      this.#translated.set(capture.processingTarget, counts)
    }
    const index = counts.get(job.bubbleId) ?? 0
    const source = capture.sources?.[index]
    if (!source) return
    if (
      this.#port.writeThoughtTranslation(
        capture.target,
        job.bubbleId,
        index,
        source,
        original,
        translated,
      )
    ) {
      if (this.liveAttempt(job, attempt, capture)) counts.set(job.bubbleId, index + 1)
    }
  }
}
