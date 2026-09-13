import type { AudioEmbedRef } from "@drive-coding/core/voice/audio-embed"
import type { SpeechDirecting, TtsProvider } from "@drive-coding/core/voice/tts-types"
import type { AudioSink } from "$lib/engines/audio-sink"
import { probeAudioFile } from "./probe-audio-file"

export type InlineAudioFetchHooks = {
  prepareFile: (segmentId: string, file: AudioEmbedRef, ac: AbortController) => Promise<void>
  prepareSegment: (
    segmentId: string,
    stream: ReadableStream<Uint8Array>,
    ac: AbortController,
    opts: { format: "mp3" | "pcm" },
  ) => Promise<void>
  markReady: (segmentId: string) => void
  markError: (segmentId: string) => void
  markAbandoned: (segmentId: string) => void
}

/** Speaker #fetchJob file branch — probe, prepareFile, or alt text for synth. */
export async function fetchInlineAudioJob(
  sink: AudioSink,
  segmentId: string,
  file: AudioEmbedRef,
  signal: AbortSignal,
): Promise<"ready" | "alt" | "abandoned"> {
  const ok = await probeAudioFile(file.uri, signal)
  if (signal.aborted) return "abandoned"
  if (ok && sink.prepareFile) {
    const ac = new AbortController()
    signal.addEventListener("abort", () => ac.abort(), { once: true })
    await sink.prepareFile(segmentId, file, ac)
    return "ready"
  }
  return "alt"
}

export function bubbleInlineAudioHooks(
  playlist: {
    prepareSegmentForBubble: InlineAudioFetchHooks["prepareSegment"]
    markReady: (segmentId: string) => void
    markError: (segmentId: string) => void
    markAbandoned: (segmentId: string) => void
  },
  stream: AudioSink,
): InlineAudioFetchHooks {
  return {
    prepareFile: (segmentId, file, ac) => stream.prepareFile?.(segmentId, file, ac) ?? Promise.resolve(),
    prepareSegment: (segmentId, s, ac, opts) => playlist.prepareSegmentForBubble(segmentId, s, ac, opts),
    markReady: (segmentId) => playlist.markReady(segmentId),
    markError: (segmentId) => playlist.markError(segmentId),
    markAbandoned: (segmentId) => playlist.markAbandoned(segmentId),
  }
}

export async function fetchInlineAudioForBubble(
  segId: string,
  file: AudioEmbedRef,
  ac: AbortController,
  provider: TtsProvider,
  voiceId: string,
  modelId: string | undefined,
  directing: SpeechDirecting,
  hooks: InlineAudioFetchHooks,
): Promise<void> {
  const ok = await probeAudioFile(file.uri, ac.signal)
  if (ac.signal.aborted) {
    hooks.markAbandoned(segId)
    return
  }
  if (ok) {
    await hooks.prepareFile(segId, file, ac)
    hooks.markReady(segId)
    return
  }
  const alt = file.title
  if (alt.length === 0) {
    hooks.markError(segId)
    return
  }
  const stream = await provider.synthesize({ text: alt, voiceId, modelId, signal: ac.signal, directing })
  await hooks.prepareSegment(segId, stream, ac, { format: provider.format })
  hooks.markReady(segId)
}
