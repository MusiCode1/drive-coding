import { AudioQueue } from "$lib/audio/player"
import { Recorder } from "$lib/audio/recorder"
import type { AgentSessionPublic } from "./agent-session.svelte"

export type VoiceState = "idle" | "recording" | "transcribing" | "thinking" | "speaking"

/**
 * createVoiceSessionStore — Svelte 5 rune-based store for voice interaction.
 *
 * Manages:
 * - Push-to-talk recording lifecycle (MediaRecorder)
 * - Audio queue playback (HTMLAudioElement)
 * - Voice state machine: idle → recording → transcribing → thinking → speaking → idle
 *
 * Designed to work alongside createAgentSessionStore.
 * Voice WS messages are routed via agentSession.setVoiceMessageHandler.
 */
export function createVoiceSessionStore(agentSession: AgentSessionPublic) {
  let voiceState = $state<VoiceState>("idle")
  let sttText = $state<string | null>(null)
  let voiceError = $state<string | null>(null)

  const recorder = new Recorder()
  const player = new AudioQueue({
    onStateChange: (playing) => {
      if (playing) {
        voiceState = "speaking"
      } else if (voiceState === "speaking") {
        voiceState = "idle"
      }
    },
  })

  // Register voice message handler on the agent session
  agentSession.setVoiceMessageHandler((raw: string) => {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const msgType = parsed.type as string
      switch (msgType) {
        case "audio_chunk":
          if (voiceState === "thinking" || voiceState === "speaking") {
            player.enqueue(parsed.mp3Base64 as string)
          }
          break
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

      // Convert blob to base64 (chunked for large buffers)
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

  function cancel(): void {
    player.clear()
    voiceState = "idle"
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
    startRecording,
    stopRecording,
    cancel,
  }
}
