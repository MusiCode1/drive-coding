/**
 * context.ts — צמדי createContext עבור הסינגלטונים של האפליקציה.
 *
 * צמדי Context עבור view-models עצמאיים; שמונת שירותי הקול חולקים VoiceFacade
 * אחד. השתמש ב-`set*` בנקודת ההרכבה (+layout.svelte) וב-selectors של `get*`
 * בכל רכיב שתחתיו.
 *
 * ─── עיצוב תוספתי בטוח למקביליות ───
 *
 * הוספת צמד Context עצמאי: הוסף בלוק `// ─── <domain> ───` חדש בסוף
 * הקובץ. אל תערוך בלוקים קיימים. ייבואים הולכים לבלוק הייבוא
 * למעלה (סדר אלפביתי בתוך קבוצה זה נחמד אבל לא חובה).
 */

import { createContext } from "svelte"
import type { AudioPlaylist } from "./engines/audio-playlist.svelte"
import type { CuesEngine } from "./engines/cues"
import type { NotifyEngine } from "./engines/notify.svelte"
import type { ChatScrollBridge } from "./types/chat-scroll"
import type { ActiveAgents } from "./view-models/active-agents.svelte"
import type { AgentSession } from "./view-models/agent-session.svelte"
import type { BubblePlayer } from "./view-models/bubble-player.svelte"
import type { CliAvailability } from "./view-models/cli-availability.svelte"
import type { ComposerDraft } from "./view-models/composer-draft.svelte"
import type { ContentViewerVM } from "./view-models/content-viewer.svelte"
import type { ModelStatus } from "./view-models/derived/model-status.svelte"
import type { VoiceMode } from "./view-models/derived/voice-mode.svelte"
import type { Dictate } from "./view-models/dictate.svelte"
import type { I18nVM } from "./view-models/i18n.svelte"
import type { Live } from "./view-models/live.svelte"
import type { Mic } from "./view-models/mic.svelte"
import type { ModalsVM } from "./view-models/modals.svelte"
import type { PresencePoller } from "./view-models/presence-poller.svelte"
import type { RecentProjects } from "./view-models/recent-projects.svelte"
import type { ResponsiveVM } from "./view-models/responsive.svelte"
import type { SessionMemoVM } from "./view-models/session-memo.svelte"
import type { Settings } from "./view-models/settings.svelte"
import type { Speaker } from "./view-models/speaker.svelte"
import type { ThemeVM } from "./view-models/theme.svelte"
import type { UiShellVM } from "./view-models/ui-shell.svelte"

// ─── i18n ──────────────────────────────────────────
export const [getI18n, setI18n] = createContext<I18nVM>()

// ─── הגדרות ──────────────────────────────────────
export const [getSettings, setSettings] = createContext<Settings>()

// ─── סשן ───────────────────────────────────────
export const [getSession, setSession] = createContext<AgentSession>()

// ─── voice ───────────────────────────────────────
export type VoiceFacade = Readonly<{
  speaker: Speaker
  mic: Mic
  live: Live
  voiceMode: VoiceMode
  cues: CuesEngine
  bubblePlayer: BubblePlayer
  audioPlaylist: AudioPlaylist
  dictate: Dictate
}>
export const [getVoice, setVoice] = createContext<VoiceFacade>()
export const getSpeaker = (): Speaker => getVoice().speaker
export const getMic = (): Mic => getVoice().mic
export const getLive = (): Live => getVoice().live
export const getVoiceMode = (): VoiceMode => getVoice().voiceMode
export const getCues = (): CuesEngine => getVoice().cues
export const getBubblePlayer = (): BubblePlayer => getVoice().bubblePlayer
export const getAudioPlaylist = (): AudioPlaylist => getVoice().audioPlaylist
export const getDictate = (): Dictate => getVoice().dictate

// ─── car-mode ─── (slice 7 יוסיף כאן)

// ─── theme ───
export const [getTheme, setTheme] = createContext<ThemeVM>()

// ─── responsive ─── (redesign-2)
export const [getResponsive, setResponsive] = createContext<ResponsiveVM>()

// ─── ui-shell ─── (redesign-2)
export const [getUiShell, setUiShell] = createContext<UiShellVM>()

// ─── modals ─── (redesign-6)
export const [getModals, setModals] = createContext<ModalsVM>()

// ─── active-agents ─── (slice active-agents-widget)
export const [getActiveAgents, setActiveAgents] = createContext<ActiveAgents>()

// ─── model-status ─── (msr-v2)
export const [getModelStatus, setModelStatus] = createContext<ModelStatus>()

// ─── chat-scroll bridge ─── (slice chat-virtualization)
export const [getChatScroll, setChatScroll] = createContext<ChatScrollBridge>()

// ─── content-viewer ─── (slice content-viewer)
export const [getContentViewer, setContentViewer] = createContext<ContentViewerVM>()

// ─── recent-projects ─── (slice connect-recent-projects)
export const [getRecentProjects, setRecentProjects] = createContext<RecentProjects>()

// ─── cli-availability ─── (slice cli-branding, Commit 3)
export const [getCliAvailability, setCliAvailability] = createContext<CliAvailability>()

// ─── presence-poller ─── (slice liveness C3)
export const [getPresencePoller, setPresencePoller] = createContext<PresencePoller>()

// ─── notifications ─── (slice notify-local)
export const [getNotify, setNotify] = createContext<NotifyEngine>()

// ─── composer-draft ─── (slice dictate-to-input)
export const [getComposerDraft, setComposerDraft] = createContext<ComposerDraft>()

// ─── session-memo ─── (slice session-memo-pad)
export const [getSessionMemo, setSessionMemo] = createContext<SessionMemoVM>()
