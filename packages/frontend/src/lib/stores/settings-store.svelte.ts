/**
 * settings-store.svelte.ts — Phase 12.
 *
 * Persisted settings (localStorage). Voice picker, thought voice, audio cues, language.
 */
import { createLogger } from "$lib/log"

const log = createLogger("fe.settings")
const STORAGE_KEY = "drive-coding-settings-v1"

export type AudioCues = {
  recordingStart: boolean
  thinking: boolean
  speaking: boolean
  error: boolean
}

export type Settings = {
  voiceId: string
  thoughtVoiceId: string | "same"
  audioCues: AudioCues
  language: "he"
}

const DEFAULTS: Settings = {
  voiceId: "EXAVITQu4vr4xnSDxMaL", // Sarah (ElevenLabs)
  thoughtVoiceId: "same",
  audioCues: {
    recordingStart: true,
    thinking: true,
    speaking: true,
    error: true,
  },
  language: "he",
}

function load(): Settings {
  if (typeof localStorage === "undefined")
    return { ...DEFAULTS, audioCues: { ...DEFAULTS.audioCues } }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      log.debug({}, "load: no saved settings, using defaults")
      return { ...DEFAULTS, audioCues: { ...DEFAULTS.audioCues } }
    }
    const parsed = JSON.parse(raw) as Partial<Settings>
    log.debug({}, "load: settings loaded from localStorage")
    return {
      ...DEFAULTS,
      ...parsed,
      audioCues: { ...DEFAULTS.audioCues, ...(parsed.audioCues ?? {}) },
    }
  } catch (e: unknown) {
    log.warn({ err: String(e) }, "load: localStorage parse error, using defaults")
    return { ...DEFAULTS, audioCues: { ...DEFAULTS.audioCues } }
  }
}

function save(s: Settings): void {
  if (typeof localStorage === "undefined") return
  log.debug({}, "save: settings saved to localStorage")
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}

let settings = $state<Settings>(load())

export const settingsStore = {
  get voiceId() {
    return settings.voiceId
  },
  get thoughtVoiceId() {
    return settings.thoughtVoiceId
  },
  get audioCues() {
    return settings.audioCues
  },
  get language() {
    return settings.language
  },
  setVoiceId(v: string) {
    settings = { ...settings, voiceId: v }
    save(settings)
  },
  setThoughtVoiceId(v: string | "same") {
    settings = { ...settings, thoughtVoiceId: v }
    save(settings)
  },
  setAudioCue(key: keyof AudioCues, value: boolean) {
    settings = { ...settings, audioCues: { ...settings.audioCues, [key]: value } }
    save(settings)
  },
  setLanguage(lang: "he") {
    settings = { ...settings, language: lang }
    save(settings)
  },
  reset() {
    settings = { ...DEFAULTS, audioCues: { ...DEFAULTS.audioCues } }
    save(settings)
  },
}
