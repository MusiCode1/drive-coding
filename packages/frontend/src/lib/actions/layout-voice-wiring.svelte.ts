/**
 * layout-voice-wiring.svelte.ts — composition root for the voice stack (extracted from +layout).
 *
 * Live (Gemini secretary), Speaker (TTS), VoiceMode and AgentVoice (the agent's native Live)
 * depend on each other and on the same session/mic/audio entities. Built and provided here so the
 * layout only passes its shared entities in.
 *
 * Slice: codex-voice-poc (extraction tax on +layout.svelte).
 */

import type { OrderAllocator } from "@drive-coding/core/voice/tts-queue"
import { setAgentVoice, setLive, setSpeaker, setVoiceMode } from "$lib/context"
import type { AudioPlaylist } from "$lib/engines/audio-playlist.svelte"
import type { CuesEngine } from "$lib/engines/cues"
import type { PlayableSink } from "$lib/engines/playable-sink"
import type { AgentSession } from "../view-models/agent-session.svelte"
import { AgentVoice } from "../view-models/agent-voice.svelte"
import type { AudioDevicesVM } from "../view-models/audio-devices.svelte"
import { VoiceMode } from "../view-models/derived/voice-mode.svelte"
import type { I18nVM } from "../view-models/i18n.svelte"
import { Live } from "../view-models/live.svelte"
import type { Mic } from "../view-models/mic.svelte"
import type { Settings } from "../view-models/settings.svelte"
import { Speaker } from "../view-models/speaker.svelte"
import type { ThemeVM } from "../view-models/theme.svelte"

export interface VoiceStackDeps {
  mic: Mic
  session: AgentSession
  settings: Settings
  i18n: I18nVM
  cues: CuesEngine
  audioDevices: AudioDevicesVM
  playlist: AudioPlaylist
  audioStream: PlayableSink
  orderAlloc: OrderAllocator
  getTheme: () => ThemeVM
}

export function installVoiceStack(deps: VoiceStackDeps): { speaker: Speaker } {
  const { mic, session, settings, i18n } = deps
  // ─── live ─── (slice live-ears — תלוי ב-mic)
  const live = new Live({
    mic,
    session,
    language: i18n.locale === "he" ? "he" : "en",
    getVoiceName: () => settings.liveVoice,
    getSettings: () => settings,
    getTheme: deps.getTheme,
    getInputDeviceId: () => deps.audioDevices.effectiveInputId,
  })
  // ─── speaker ─── (§4.3: live ref — TTS off while Live open)
  const speaker = new Speaker({
    session,
    settings,
    cues: deps.cues,
    playlist: deps.playlist,
    audioStream: deps.audioStream,
    orderAlloc: deps.orderAlloc,
    live,
  })
  // ─── voice-mode ─── (slice 3 — תלוי ב-mic + session + speaker + live)
  const voiceMode = new VoiceMode({ mic, session, speaker, playlist: deps.playlist, live })
  // ─── agent-voice ─── (slice codex-voice-poc — the agent's native Live)
  const agentVoice = new AgentVoice({
    session,
    getInstructions: () => i18n.t("agentVoice.instructions"),
    getPermissionSpeech: () => i18n.t("agentVoice.permissionSpeech"),
  })
  setLive(live)
  setSpeaker(speaker)
  setVoiceMode(voiceMode)
  setAgentVoice(agentVoice)
  return { speaker }
}
