import { AudioQueue } from "$lib/audio/player"
import { Recorder } from "$lib/audio/recorder"
import type { AgentSessionPublic } from "./agent-session.svelte"

export type VoiceState = "idle" | "recording" | "transcribing" | "thinking" | "speaking"

/**
 * Phase 5 (Tier 1): metadata stored per segmentId.
 * Populated from audio_chunk events.
 */
export type SegmentMeta = {
  kind: "message" | "thought" | "narration"
  originalText?: string
  translatedText?: string
}

/**
 * createVoiceSessionStore — Svelte 5 rune-based store for voice interaction.
 *
 * Phase 5 additions:
 *  - segmentCache: Map<segmentId, SegmentMeta> — keyed by Tier 1 segmentId
 *  - currentlyPlayingSegmentId: tracks which segment is currently playing
 *  - playingSegmentQueue: parallel to AudioQueue, maps segments to IDs
 */
export function createVoiceSessionStore(agentSession: AgentSessionPublic) {
  let voiceState = $state<VoiceState>("idle")
  let sttText = $state<string | null>(null)
  let voiceError = $state<string | null>(null)
  let hasReplayable = $state(false)

  // Phase 5: Tier 1 segment tracking
  const segmentCache = new Map<string, SegmentMeta>()
  /** segmentIds in the order they were enqueued — parallel to the AudioQueue. */
  let playingSegmentQueue: Array<string | null> = []
  let currentlyPlayingSegmentId = $state<string | null>(null)

  const recorder = new Recorder()
  const player = new AudioQueue({
    onStateChange: (playing) => {
      if (playing) {
        voiceState = "speaking"
        hasReplayable = true
        // Phase 5: update currently playing segment from the queue
        currentlyPlayingSegmentId = playingSegmentQueue.shift() ?? null
      } else if (voiceState === "speaking") {
        voiceState = "idle"
        currentlyPlayingSegmentId = null
      }
    },
  })

  // Register voice message handler on the agent session
  agentSession.setVoiceMessageHandler((raw: string) => {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const msgType = parsed.type as string
      switch (msgType) {
        case "audio_chunk": {
          if (voiceState === "thinking" || voiceState === "speaking") {
            const mp3Base64 = parsed.mp3Base64 as string
            const segmentId = parsed.segmentId as string | undefined
            const kind =
              (parsed.kind as "message" | "thought" | "narration" | undefined) ?? "message"
            const originalText = parsed.originalText as string | undefined
            const translatedText = parsed.translatedText as string | undefined

            // Phase 5: cache segment metadata
            if (segmentId) {
              segmentCache.set(segmentId, { kind, originalText, translatedText })
            }

            // Push segmentId to the parallel queue BEFORE enqueue (tick() may fire synchronously)
            playingSegmentQueue.push(segmentId ?? null)
            player.enqueue(mp3Base64)
          }
          break
        }
        case "stt_partial":
          sttText = parsed.text as string
          break
        case "done":
          // If no audio chunks came, go back to idle
          if (!player.isPlaying && voiceState === "thinking") {
            voiceState = "idle"
          }
          break
        case "error":
          if (voiceState !== "idle") {
            voiceError = parsed.message as string
            voiceState = "idle"
            player.clear()
            playingSegmentQueue = []
            currentlyPlayingSegmentId = null
          }
          break
      }
    } catch {
      // ignore parse errors
    }
  })

  async function startRecording(): Promise<void> {
    if (voiceState !== "idle") return
    voiceError = null
    sttText = null
    try {
      await recorder.start()
      voiceState = "recording"
    } catch (e) {
      voiceError = e instanceof Error ? e.message : "מיקרופון לא זמין"
    }
  }

  async function stopRecording(): Promise<void> {
    if (voiceState !== "recording") return
    voiceState = "transcribing"

    try {
      const { blob, mimeType } = await recorder.stop()

      if (blob.size === 0) {
        voiceState = "idle"
        return
      }

      const arrayBuf = await blob.arrayBuffer()
      const uint8 = new Uint8Array(arrayBuf)
      let binary = ""
      const chunkSize = 8192
      for (let i = 0; i < uint8.length; i += chunkSize) {
        binary += String.fromCharCode(...uint8.subarray(i, i + chunkSize))
      }
      const base64 = btoa(binary)

      voiceState = "thinking"
      const sent = agentSession.sendRaw({
        type: "audio",
        agentId: agentSession.agentId,
        audioBase64: base64,
        mimeType,
      })

      if (!sent) {
        voiceError = "WebSocket לא מחובר"
        voiceState = "idle"
      }
    } catch (e) {
      voiceError = e instanceof Error ? e.message : "שגיאה בשליחת האודיו"
      voiceState = "idle"
    }
  }

  async function sendAudioBlob(blob: Blob, mimeType?: string): Promise<void> {
    if (blob.size === 0) return
    voiceState = "transcribing"
    voiceError = null
    sttText = null

    try {
      const arrayBuf = await blob.arrayBuffer()
      const uint8 = new Uint8Array(arrayBuf)
      let binary = ""
      const chunkSize = 8192
      for (let i = 0; i < uint8.length; i += chunkSize) {
        binary += String.fromCharCode(...uint8.subarray(i, i + chunkSize))
      }
      const base64 = btoa(binary)
      const finalMime = mimeType ?? blob.type ?? "audio/webm"

      voiceState = "thinking"
      const sent = agentSession.sendRaw({
        type: "audio",
        agentId: agentSession.agentId,
        audioBase64: base64,
        mimeType: finalMime,
      })

      if (!sent) {
        voiceError = "WebSocket לא מחובר"
        voiceState = "idle"
      }
    } catch (e) {
      voiceError = e instanceof Error ? e.message : "שגיאה בשליחת האודיו"
      voiceState = "idle"
    }
  }

  function cancel(): void {
    player.clear()
    playingSegmentQueue = []
    currentlyPlayingSegmentId = null
    voiceState = "idle"
  }

  function replayLast(): void {
    player.replayLast()
  }

  return {
    get voiceState() {
      return voiceState
    },
    get sttText() {
      return sttText
    },
    get voiceError() {
      return voiceError
    },
    get isRecording() {
      return voiceState === "recording"
    },
    get canReplayLast() {
      return hasReplayable
    },
    /** Phase 5: segmentId of the audio segment currently playing (or null). */
    get currentlyPlayingSegmentId() {
      return currentlyPlayingSegmentId
    },
    /** Phase 5: look up cached segment metadata by segmentId. */
    getSegment(segmentId: string): SegmentMeta | undefined {
      return segmentCache.get(segmentId)
    },
    startRecording,
    stopRecording,
    sendAudioBlob,
    cancel,
    replayLast,
  }
}
