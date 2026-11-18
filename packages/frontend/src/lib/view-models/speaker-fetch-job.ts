/**
 * speaker-fetch-job.ts — TTS fetch pipeline for a single Speaker segment job.
 *
 * tts-model-choice: חילוץ מ-speaker.svelte.ts (#fetchJob).
 */

import { DEFAULT_VOICE_CONFIG } from "@drive-coding/core/voice/capabilities"
import { select } from "@drive-coding/core/voice/select"
import { translate } from "../adapters/voice/translate"
import type { Settings } from "./settings.svelte"
import type { FetchOutcome, TtsJob } from "./speaker.svelte"
import { synthesizeSpeakerSegment } from "./speaker-tts-synthesize"

const TARGET_LANG = "he" as const

export type SpeakerFetchJobDeps = {
  settings: Settings
  narrateForJob: (job: TtsJob) => Promise<string | null>
  persistThoughtTranslation: (
    bubbleId: string,
    originalEnglish: string,
    translatedHebrew: string,
  ) => void
  prepareSegment: (
    segmentId: string,
    stream: ReadableStream<Uint8Array>,
    abort: AbortController,
    meta: { messageId: string | null; textHash: string; format: "pcm" | "mp3" },
  ) => Promise<void>
}

export async function executeSpeakerFetchJob(
  job: TtsJob,
  deps: SpeakerFetchJobDeps,
): Promise<FetchOutcome> {
  try {
    let text = job.text

    if (job.kind === "thought") {
      if (deps.settings.translateThoughts) {
        const result = await translate(
          text,
          TARGET_LANG,
          select("translate", DEFAULT_VOICE_CONFIG),
          job.abort.signal,
          job.messageId,
        )
        if (result !== null && result.status === "translated") {
          if (job.bubbleId !== undefined) {
            deps.persistThoughtTranslation(job.bubbleId, job.text, result.text)
          }
          text = result.text
        }
      }
    } else if (job.kind === "tool") {
      const narrationText = await deps.narrateForJob(job)
      if (narrationText === null) {
        job.status = "error"
        return { kind: "error", reason: "narration-null" }
      }
      text = narrationText
    }

    if (job.abort.signal.aborted) {
      job.status = "error"
      return { kind: "abandoned" }
    }

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
      signal: job.abort.signal,
    })
    if (!synth.ok) {
      job.status = "error"
      console.warn("[Speaker] TTS provider unavailable, skipping segment", {
        provider: deps.settings.ttsProvider,
        id: job.segmentId,
      })
      return { kind: "error", reason: "provider-unavailable" }
    }
    await deps.prepareSegment(job.segmentId, synth.stream, job.abort, {
      messageId: job.messageId,
      textHash: synth.textHash,
      format: synth.format,
    })
    job.status = "ready"
    return { kind: "ready" }
  } catch (e) {
    if (job.abort.signal.aborted) {
      job.status = "error"
      return { kind: "abandoned" }
    }
    job.status = "error"
    console.warn("TTS job failed, skipping segment", {
      id: job.segmentId,
      err: e instanceof Error ? e.message : String(e),
    })
    return { kind: "error", reason: "synthesize-failed" }
  }
}
