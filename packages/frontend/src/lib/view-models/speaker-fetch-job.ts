/** TTS fetch pipeline; every continuation belongs to one captured attempt and content. */
import { DEFAULT_VOICE_CONFIG } from "@drive-coding/core/voice/capabilities"
import { select } from "@drive-coding/core/voice/select"
import { translate } from "../adapters/voice/translate"
import type { Settings } from "./settings.svelte"
import type { FetchOutcome, TtsJob } from "./speaker.svelte"
import type { AnnotationJobCapture } from "./speaker-annotation-jobs"
import { synthesizeSpeakerSegment } from "./speaker-tts-synthesize"

const TARGET_LANG = "he" as const

export type SpeakerFetchJobDeps = {
  settings: Settings
  narrateForJob: (
    job: TtsJob,
    attempt: AbortController,
    capture: AnnotationJobCapture | undefined,
  ) => Promise<string | null>
  persistThoughtTranslation: (
    job: TtsJob,
    attempt: AbortController,
    capture: AnnotationJobCapture | undefined,
    originalEnglish: string,
    translatedHebrew: string,
  ) => void
  isCurrent: (capture: AnnotationJobCapture | undefined) => boolean
  prepareSegment: (
    segmentId: string,
    stream: ReadableStream<Uint8Array>,
    abort: AbortController,
    meta: { messageId: string | null; textHash: string; format: "pcm" | "mp3" },
  ) => Promise<void>
}

export async function executeSpeakerFetchJob(
  job: TtsJob,
  attempt: AbortController,
  capture: AnnotationJobCapture | undefined,
  deps: SpeakerFetchJobDeps,
): Promise<FetchOutcome> {
  const ownsAttempt = () => job.abort === attempt
  const currentContent = () => deps.isCurrent(capture)
  const liveAttempt = () => ownsAttempt() && !attempt.signal.aborted && currentContent()
  const abandoned = (): FetchOutcome => {
    if (ownsAttempt() && currentContent()) job.status = "error"
    return { kind: "abandoned" }
  }
  try {
    if (!liveAttempt()) return abandoned()
    let text = job.text
    if (job.kind === "thought") {
      if (deps.settings.translateThoughts) {
        const result = await translate(
          text,
          TARGET_LANG,
          select("translate", DEFAULT_VOICE_CONFIG),
          attempt.signal,
          job.messageId,
        )
        if (!liveAttempt()) return abandoned()
        if (result !== null && result.status === "translated") {
          if (job.bubbleId !== undefined) {
            deps.persistThoughtTranslation(job, attempt, capture, job.text, result.text)
          }
          text = result.text
        }
      }
    } else if (job.kind === "tool") {
      const narrationText = await deps.narrateForJob(job, attempt, capture)
      if (!liveAttempt()) return abandoned()
      if (narrationText === null) {
        job.status = "error"
        return { kind: "error", reason: "narration-null" }
      }
      text = narrationText
    }
    if (!liveAttempt()) return abandoned()
    const synth = await synthesizeSpeakerSegment({
      ttsProvider: deps.settings.ttsProvider,
      voiceId: deps.settings.voiceId,
      geminiVoice: deps.settings.geminiVoice,
      models: {
        elevenLabsModelId: deps.settings.elevenLabsModelId,
        geminiModelId: deps.settings.geminiModelId,
      },
      geminiPace: deps.settings.geminiPace,
      geminiTone: deps.settings.geminiTone,
      text,
      messageId: job.messageId,
      signal: attempt.signal,
      liveAttempt,
    })
    if (!liveAttempt()) {
      if (synth.ok) {
        try {
          await synth.stream.cancel()
        } catch {
          // Best-effort release of a stale stream; it must never enter the sink.
        }
      }
      return abandoned()
    }
    if (!synth.ok) {
      job.status = "error"
      console.warn("[Speaker] TTS provider unavailable, skipping segment", {
        provider: deps.settings.ttsProvider,
        id: job.segmentId,
      })
      return { kind: "error", reason: "provider-unavailable" }
    }
    await deps.prepareSegment(job.segmentId, synth.stream, attempt, {
      messageId: job.messageId,
      textHash: synth.textHash,
      format: synth.format,
    })
    if (!liveAttempt()) return abandoned()
    job.status = "ready"
    return { kind: "ready" }
  } catch (e) {
    if (!liveAttempt()) return abandoned()
    job.status = "error"
    console.warn("TTS job failed, skipping segment", {
      id: job.segmentId,
      err: e instanceof Error ? e.message : String(e),
    })
    return { kind: "error", reason: "synthesize-failed" }
  }
}
