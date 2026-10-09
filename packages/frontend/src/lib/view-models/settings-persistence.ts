/**
 * settings-persistence.ts — load/save ל-localStorage עבור Settings VM.
 *
 * tts-model-choice: חילוץ מ-settings.svelte.ts; נרמול model IDs ב-load.
 */

import { DEFAULT_LOCALE, detectLocale, type Locale } from "@drive-coding/core/i18n"
import type { SpeechPace, SpeechTone } from "@drive-coding/core/voice/tts-types"
import type { SessionTransport } from "$lib/session/session-transport"
import {
  DEFAULT_ELEVENLABS_TTS_MODEL,
  DEFAULT_GEMINI_TTS_MODEL,
  type ElevenLabsTtsModelId,
  type GeminiTtsModelId,
  normalizeElevenLabsModelId,
  normalizeGeminiModelId,
} from "../adapters/voice/tts-resolve"
import { DEFAULT_GEMINI_VOICE, DEFAULT_LIVE_VOICE } from "../adapters/voice/voices-gemini"
import { clampSidebarWidth, DEFAULT_SIDEBAR_WIDTH_REM } from "../util/sidebar-width"
import { coerceInputMode, type InputMode } from "./ui-shell.svelte"

export const STORAGE_KEY = "drive-coding-v2-settings"

const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL" // Sarah, ElevenLabs

export type PersistedSettings = {
  cliKind: string
  lastCwd: string
  voiceId: string
  beUrl: string
  speakThoughts: boolean
  narrateTools: boolean
  translateThoughts: boolean
  carMode: boolean
  locale: Locale
  muted: boolean
  screenWakeLock: boolean
  showThoughts: boolean
  showTools: boolean
  compactActivity: boolean
  showSessionMemo: boolean
  enterToSend: boolean
  autoLoadRemoteImages: boolean
  lastConfig: Record<string, Record<string, string | boolean>>
  ttsProvider: "elevenlabs" | "google"
  recentCollapsed: boolean
  suppressLeaveWarning: boolean
  geminiVoice: string
  liveVoice: string
  projectSystemPrompt: Record<string, string>
  recentPanelHeight: number
  activePanelHeight: number
  sidebarWidthRem: number
  geminiPace: SpeechPace
  geminiTone: SpeechTone
  sessionTransport: SessionTransport | null
  notifications: boolean
  sessionsCurrentCwdOnly: boolean
  inputMode: InputMode
  elevenLabsModelId: ElevenLabsTtsModelId
  geminiModelId: GeminiTtsModelId
}

export const DEFAULTS: PersistedSettings = {
  cliKind: "opencode",
  lastCwd: "",
  voiceId: DEFAULT_VOICE_ID,
  beUrl: "",
  speakThoughts: true,
  narrateTools: true,
  translateThoughts: true,
  carMode: false,
  locale: DEFAULT_LOCALE,
  muted: true,
  screenWakeLock: true,
  showThoughts: true,
  showTools: false,
  compactActivity: false,
  showSessionMemo: false,
  enterToSend: true,
  autoLoadRemoteImages: false,
  lastConfig: {},
  ttsProvider: "elevenlabs",
  recentCollapsed: false,
  suppressLeaveWarning: false,
  geminiVoice: DEFAULT_GEMINI_VOICE,
  liveVoice: DEFAULT_LIVE_VOICE,
  projectSystemPrompt: {},
  recentPanelHeight: 256,
  activePanelHeight: 256,
  sidebarWidthRem: DEFAULT_SIDEBAR_WIDTH_REM,
  geminiPace: "normal",
  geminiTone: "neutral",
  sessionTransport: "http",
  notifications: false,
  sessionsCurrentCwdOnly: false,
  inputMode: "record",
  elevenLabsModelId: DEFAULT_ELEVENLABS_TTS_MODEL,
  geminiModelId: DEFAULT_GEMINI_TTS_MODEL,
}

/** Legacy values for fields flipped in slice fe-defaults. */
export const LEGACY_DEFAULTS: Pick<
  PersistedSettings,
  "muted" | "screenWakeLock" | "sessionTransport"
> = {
  muted: false,
  screenWakeLock: false,
  sessionTransport: null,
}

function normalizeLoaded(parsed: Partial<PersistedSettings>): Partial<PersistedSettings> {
  return {
    ...parsed,
    elevenLabsModelId: normalizeElevenLabsModelId(parsed.elevenLabsModelId),
    geminiModelId: normalizeGeminiModelId(parsed.geminiModelId),
    sidebarWidthRem: Number.isFinite(parsed.sidebarWidthRem)
      ? clampSidebarWidth(parsed.sidebarWidthRem as number)
      : undefined,
  }
}

export function loadSettings(): PersistedSettings {
  if (typeof localStorage === "undefined") return { ...DEFAULTS, locale: detectLocale() }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS, locale: detectLocale() }
    const parsed = JSON.parse(raw) as Partial<PersistedSettings> & {
      collapseThoughts?: boolean
      expandTools?: boolean
    }
    if (parsed.showThoughts === undefined && parsed.collapseThoughts !== undefined) {
      parsed.showThoughts = !parsed.collapseThoughts
    }
    if (parsed.showTools === undefined && parsed.expandTools !== undefined) {
      parsed.showTools = parsed.expandTools
    }
    const merged = { ...DEFAULTS, ...LEGACY_DEFAULTS, ...normalizeLoaded(parsed) }
    return merged
  } catch {
    return { ...DEFAULTS, ...LEGACY_DEFAULTS, locale: detectLocale() }
  }
}

export function saveSettings(s: PersistedSettings): void {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    // quota / disabled — skip silently
  }
}
