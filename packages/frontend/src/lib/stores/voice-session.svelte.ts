/**
 * voice-session.svelte.ts — Phase 3 refactor.
 *
 * State machine: idle | recording | transcribing | thinking | speaking
 *
 * Delegates to voice orchestrator for TTS queue management.
 * Uses STT client for transcription, then sends prompt via agentSession.
 *
 * Backward compat: still exports SegmentMeta + currentlyPlayingSegmentId
 * for +page.svelte bubble highlighting (until Phase 4 cleanup).
 */

import { Recorder } from "$lib/audio/recorder"
import { createLogger } from "$lib/log"
import { AudioStream } from "$lib/voice/audio-stream"
import { createVoiceOrchestrator } from "$lib/voice/orchestrator"
import { transcribe } from "$lib/voice/stt-client"
import type { AgentSessionPublic } from "./agent-session.svelte"
import type { createPlayerStore } from "./player.svelte"

export type VoiceState = "idle" | "recording" | "transcribing" | "thinking" | "speaking"

/**
 * Metadata stored per segmentId (backward compat for bubble highlighting).
 */
export type SegmentMeta = {
  kind: "message" | "thought" | "narration"
  originalText?: string
  translatedText?: string
  messageId?: string | null
}

export interface VoiceSessionDeps {
  agentSession: AgentSessionPublic
  player: ReturnType<typeof createPlayerStore>
  getVoiceId: () => string
}

export function createVoiceSessionStore(deps: VoiceSessionDeps) {
  const { agentSession, player } = deps
  const log = createLogger("fe.voice").child({ agentId: agentSession.agentId })

  let voiceState = $state<VoiceState>("idle")
  let sttText = $state<string | null>(null)
  let voiceError = $state<string | null>(null)
  let hasReplayable = $state(false)

  // Phase 3: segment tracking for backward compat with +page.svelte bubble highlighting
  const segmentCache = new Map<string, SegmentMeta>()
  let currentlyPlayingSegmentId = $state<string | null>(null)

  // AudioStream + Orchestrator
  const audioStream = new AudioStream()
  const orchestrator = createVoiceOrchestrator({
    agentSession,
    player,
    audioStream,
    getVoiceId: deps.getVoiceId,
  })

  // Track currently playing segment via player callbacks (no $effect — works outside component)
  player.onAdvance((newIndex) => {
    const item = player.playlist[newIndex] ?? null
    if (item) {
      currentlyPlayingSegmentId = item.segmentId
      hasReplayable = true
      if (voiceState === "thinking") {
        setState("speaking")
      }
    }
  })

  player.onJump((newIndex) => {
    const item = player.playlist[newIndex] ?? null
    currentlyPlayingSegmentId = item?.segmentId ?? null
    if (item) {
      hasReplayable = true
      if (voiceState === "thinking") {
        setState("speaking")
      }
    } else if (voiceState === "speaking") {
      setState("idle")
    }
  })

  const recorder = new Recorder()

  function setState(next: VoiceState): void {
    if (voiceState === next) return
    log.info({ from: voiceState, to: next }, "state transition")
    voiceState = next
  }

  async function startRecording(): Promise<void> {
    if (voiceState !== "idle") return
    voiceError = null
    sttText = null
    try {
      await recorder.start()
      setState("recording")
    } catch (e) {
      log.error({ err: e }, "mic permission denied")
      voiceError = e instanceof Error ? e.message : "מיקרופון לא זמין"
    }
  }

  async function stopRecording(): Promise<void> {
    if (voiceState !== "recording") return
    setState("transcribing")

    try {
      const { blob } = await recorder.stop()

      if (blob.size === 0) {
        setState("idle")
        return
      }

      await sendAudioBlob(blob)
    } catch (e) {
      log.warn({ err: e }, "stopRecording failed")
      voiceError = e instanceof Error ? e.message : "שגיאה בשליחת האודיו"
      setState("idle")
    }
  }

  async function sendAudioBlob(blob: Blob, mimeType?: string): Promise<void> {
    if (blob.size === 0) return
    setState("transcribing")
    voiceError = null
    sttText = null

    try {
      // STT via Gemini (FE-side, through BE proxy)
      const finalBlob =
        mimeType && mimeType !== blob.type
          ? new Blob([await blob.arrayBuffer()], { type: mimeType })
          : blob

      // Use last assistant message as context for STT
      const lastAssistant = agentSession.bubbles
        .filter((b) => b.kind === "message")
        .map((b) => b.segments.map((s) => s.text ?? "").join(""))
        .filter((t) => t.length > 0)
        .slice(-1)[0]

      const { text } = await transcribe(finalBlob, {
        previousAssistantText: lastAssistant,
      })

      if (!text.trim()) {
        setState("idle")
        return
      }

      sttText = text
      // Update orchestrator's user message context
      orchestrator.setUserMessage(text)

      setState("thinking")

      // Send via ACP
      agentSession.sendPrompt(text)
    } catch (e) {
      log.warn({ err: e }, "sendAudioBlob failed")
      voiceError = e instanceof Error ? e.message : "שגיאה בשליחת האודיו"
      setState("idle")
    }
  }

  function cancel(): void {
    orchestrator.cancelAll()
    audioStream.clear()
    player.clear()
    setState("idle")
    currentlyPlayingSegmentId = null
    agentSession.cancel()
  }

  function replayLast(): void {
    const item = player.replayLastResponse()
    if (item) {
      hasReplayable = true
      audioStream.play(item.segmentId).catch(() => {})
    }
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
    /** Phase 3: segmentId of the audio segment currently playing (or null). */
    get currentlyPlayingSegmentId() {
      return currentlyPlayingSegmentId
    },
    /** Phase 3: look up cached segment metadata by segmentId (backward compat). */
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
