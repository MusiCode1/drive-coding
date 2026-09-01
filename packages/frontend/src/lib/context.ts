/**
 * context.ts — צמדי createContext עבור הסינגלטונים של האפליקציה.
 *
 * צמד אחד לכל view-model ראשי. השתמש ב-`set*` בנקודת ההרכבה (composition root)
 * (+layout.svelte) וב-`get*` בכל רכיב שתחתיו.
 *
 * ─── עיצוב תוספתי בטוח למקביליות ───
 *
 * הוספת צמד VM חדש: הוסף בלוק `// ─── <domain> ───` חדש בסוף
 * הקובץ. אל תערוך בלוקים קיימים. ייבואים הולכים לבלוק הייבוא
 * למעלה (סדר אלפביתי בתוך קבוצה זה נחמד אבל לא חובה).
 */

import { createContext } from "svelte"
import type { AgentSession } from "./view-models/agent-session.svelte"
import type { ChatScrollBridge } from "./types/chat-scroll"
import type { CliAvailability } from "./view-models/cli-availability.svelte"
import type { I18nVM } from "./view-models/i18n.svelte"
import type { Mic } from "./view-models/mic.svelte"
import type { ResponsiveVM } from "./view-models/responsive.svelte"
import type { Settings } from "./view-models/settings.svelte"
import type { Speaker } from "./view-models/speaker.svelte"
import type { ThemeVM } from "./view-models/theme.svelte"
import type { UiShellVM } from "./view-models/ui-shell.svelte"
import type { Live } from "./view-models/live.svelte"
import type { VoiceMode } from "./view-models/derived/voice-mode.svelte"
import type { ModelStatus } from "./view-models/derived/model-status.svelte"
import type { CuesEngine } from "./engines/cues"
import type { ModalsVM } from "./view-models/modals.svelte"
import type { ActiveAgents } from "./view-models/active-agents.svelte"
import type { BubblePlayer } from "./view-models/bubble-player.svelte"
import type { ContentViewerVM } from "./view-models/content-viewer.svelte"
import type { RecentProjects } from "./view-models/recent-projects.svelte"
import type { AudioPlaylist } from "./engines/audio-playlist.svelte"
import type { PresencePoller } from "./view-models/presence-poller.svelte"
import type { NotifyEngine } from "./engines/notify.svelte"
import type { ComposerDraft } from "./view-models/composer-draft.svelte"
import type { Dictate } from "./view-models/dictate.svelte"

// ─── i18n ──────────────────────────────────────────
export const [getI18n, setI18n] = createContext<I18nVM>()

// ─── הגדרות ──────────────────────────────────────
export const [getSettings, setSettings] = createContext<Settings>()

// ─── סשן ───────────────────────────────────────
export const [getSession, setSession] = createContext<AgentSession>()

// ─── speaker ───────────────────────────────────────
export const [getSpeaker, setSpeaker] = createContext<Speaker>()

// ─── mic ─── (slice 3)
export const [getMic, setMic] = createContext<Mic>()

// ─── live ─── (slice live-ears)
export const [getLive, setLive] = createContext<Live>()

// ─── voice-mode ─── (slice 3)
export const [getVoiceMode, setVoiceMode] = createContext<VoiceMode>()

// ─── cues ─── (slice 6)
export const [getCues, setCues] = createContext<CuesEngine>()

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

// ─── bubble-player ─── (msr-v2)
export const [getBubblePlayer, setBubblePlayer] = createContext<BubblePlayer>()

// ─── chat-scroll bridge ─── (slice chat-virtualization)
export const [getChatScroll, setChatScroll] = createContext<ChatScrollBridge>()

// ─── content-viewer ─── (slice content-viewer)
export const [getContentViewer, setContentViewer] = createContext<ContentViewerVM>()

// ─── recent-projects ─── (slice connect-recent-projects)
export const [getRecentProjects, setRecentProjects] = createContext<RecentProjects>()

// ─── audio-playlist ─── (slice A4 — shared between Speaker + BubblePlayer)
export const [getAudioPlaylist, setAudioPlaylist] = createContext<AudioPlaylist>()

// ─── cli-availability ─── (slice cli-branding, Commit 3)
export const [getCliAvailability, setCliAvailability] = createContext<CliAvailability>()

// ─── presence-poller ─── (slice liveness C3)
export const [getPresencePoller, setPresencePoller] = createContext<PresencePoller>()

// ─── notifications ─── (slice notify-local)
export const [getNotify, setNotify] = createContext<NotifyEngine>()

// ─── composer-draft ─── (slice dictate-to-input)
export const [getComposerDraft, setComposerDraft] = createContext<ComposerDraft>()

// ─── dictate ─── (slice dictate-to-input)
export const [getDictate, setDictate] = createContext<Dictate>()
