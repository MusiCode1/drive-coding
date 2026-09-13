import { cacheKeyFor } from "@drive-coding/core/voice/cache-key"
import { DEFAULT_VOICE_CONFIG } from "@drive-coding/core/voice/capabilities"
import { select } from "@drive-coding/core/voice/select"
import { translate } from "$lib/adapters/voice/translate"
import { resolveTts } from "$lib/adapters/voice/tts-resolve"
import type { AudioSink } from "$lib/engines/audio-sink"
import { ttsCapabilities } from "$lib/view-models/capabilities.svelte"
import type { FetchOutcome, TtsJob } from "$lib/engines/tts-job-types"
import type { Settings } from "$lib/view-models/settings.svelte"
import { fetchInlineAudioJob } from "./inline-audio-fetch"

const TARGET_LANG = "he" as const

export type SpeakerFetchDeps = {
  settings: Settings
  audioStream: AudioSink
  narrateForJob: (job: TtsJob) => Promise<string | null>
  persistThoughtTranslation: (
    bubbleId: string,
    originalEnglish: string,
    translatedHebrew: string,
  ) => void
  onPendingDone: () => void
}

export async function runSpeakerFetchJob(job: TtsJob, deps: SpeakerFetchDeps): Promise<FetchOutcome> {
  try {
    let text = job.text

    if (job.kind === "file" && job.file !== undefined) {
      const outcome = await fetchInlineAudioJob(
        deps.audioStream,
        job.segmentId,
        job.file,
        job.abort.signal,
      )
      if (outcome === "abandoned") {
        job.status = "error"
        return { kind: "abandoned" }
      }
      if (outcome === "ready") {
        job.status = "ready"
        return { kind: "ready" }
      }
      text = job.file.title.length > 0 ? job.file.title : job.text
    } else if (job.kind === "thought") {
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

    const { provider, voiceId, modelId } = resolveTts(
      deps.settings.ttsProvider,
      deps.settings.voiceId,
      deps.settings.geminiVoice,
    )
    if (!ttsCapabilities.isAvailable(deps.settings.ttsProvider)) {
      job.status = "error"
      console.warn("[Speaker] TTS provider unavailable, skipping segment", {
        provider: deps.settings.ttsProvider,
        id: job.segmentId,
      })
      return { kind: "error", reason: "provider-unavailable" }
    }
    const textHash = await cacheKeyFor(text, voiceId, modelId)
    const stream = await provider.synthesize({
      text,
      voiceId,
      modelId,
      messageId: job.messageId,
      signal: job.abort.signal,
      directing: { pace: deps.settings.geminiPace, tone: deps.settings.geminiTone },
    })
    await deps.audioStream.prepareSegment(job.segmentId, stream, job.abort, {
      messageId: job.messageId,
      textHash,
      format: provider.format,
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
  } finally {
    deps.onPendingDone()
  }
}
