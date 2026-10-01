import { OrderAllocator } from "@drive-coding/core/voice/tts-queue"
import { AudioPlaylist } from "$lib/engines/audio-playlist.svelte"
import type { CuesEngine } from "$lib/engines/cues"
import { PlayableSink } from "$lib/engines/playable-sink"
import type { AgentSession } from "$lib/view-models/agent-session.svelte"
import { BubblePlayer } from "$lib/view-models/bubble-player.svelte"
import { ModelStatus } from "$lib/view-models/derived/model-status.svelte"
import { VoiceMode } from "$lib/view-models/derived/voice-mode.svelte"
import { Live } from "$lib/view-models/live.svelte"
import type { Mic } from "$lib/view-models/mic.svelte"
import type { Settings } from "$lib/view-models/settings.svelte"
import { Speaker } from "$lib/view-models/speaker.svelte"
import type { ThemeVM } from "$lib/view-models/theme.svelte"

export function createAudioQueue() {
  const audioStream = new PlayableSink()
  const orderAlloc = new OrderAllocator()
  const playlist = new AudioPlaylist(audioStream)
  return { audioStream, orderAlloc, playlist }
}

export function createVoiceLive(
  mic: Mic,
  session: AgentSession,
  settings: Settings,
  language: "he" | "en",
  getTheme: () => ThemeVM,
): Live {
  return new Live({
    mic,
    session,
    language,
    getVoiceName: () => settings.liveVoice,
    getSettings: () => settings,
    getTheme,
  })
}

/** Voice output assembly; keeps the layout's instance creation order. */
export function createVoiceOutput({
  session,
  settings,
  cues,
  audio,
  mic,
  live,
}: {
  session: AgentSession
  settings: Settings
  cues: CuesEngine
  audio: ReturnType<typeof createAudioQueue>
  mic: Mic
  live: Live
}) {
  const { playlist, audioStream, orderAlloc } = audio
  const speaker = new Speaker({
    transcript: {
      get current() {
        return session.transcript
      },
    },
    lifecycle: session,
    settings,
    cues,
    playlist,
    audioStream,
    orderAlloc,
    live,
  })
  const voiceMode = new VoiceMode({ mic, session, speaker, playlist, live })
  const modelStatus = new ModelStatus({ session, speaker })
  const bubblePlayer = new BubblePlayer({ session, settings, playlist, orderAlloc })
  return { speaker, voiceMode, modelStatus, bubblePlayer }
}
