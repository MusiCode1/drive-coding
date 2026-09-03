<script lang="ts">
/**
 * Composition root — view-models + setContext. Additive-only; see parallel-safe-code.md.
 */
import "$lib/log"
import PlaybackDebugPanel from "$lib/components/debug/PlaybackDebugPanel.svelte"
import "../app.css"
import type { Locale } from "@drive-coding/core/i18n"
import { OrderAllocator } from "@drive-coding/core/voice/tts-queue"
import { onDestroy, onMount } from "svelte"
import { page } from "$app/state"
import { env } from "$env/dynamic/public"
import {
  setActiveAgents,
  setAudioPlaylist,
  setBubblePlayer,
  setChatScroll,
  setCliAvailability,
  setContentViewer,
  setComposerDraft,
  setCues,
  setDictate,
  setI18n,
  setLive,
  setMic,
  setModals,
  setNotify,
  setModelStatus,
  setPresencePoller,
  setRecentProjects,
  setResponsive,
  setSession,
  setSettings,
  setSpeaker,
  setTheme,
  setUiShell,
  setVoiceMode,
} from "$lib/context"
import { installDebugSurface } from "$lib/debug/dc"
import { AudioPlaylist } from "$lib/engines/audio-playlist.svelte"
import { createConfigChangeSocket } from "$lib/engines/config-change-socket"
import { CuesEngine } from "$lib/engines/cues"
import { createPendingCaptureWiring } from "$lib/engines/pending-capture-wiring"
import { PlayableSink } from "$lib/engines/playable-sink"
import { WakeLockEngine } from "$lib/engines/wake-lock"
import { NotifyEngine } from "$lib/engines/notify.svelte"
import { notifyTexts } from "$lib/notify-texts"
import { normalizeSessionTransport } from "$lib/session/session-transport"
import type { ChatScrollBridge } from "$lib/types/chat-scroll"
import { beWsUrl } from "$lib/util/be-url"
import { bindSessionScope } from "$lib/actions/session-scope"
import { isPageHidden } from "$lib/util/page-visibility.svelte"
import { ActiveAgents } from "$lib/view-models/active-agents.svelte"
import { AgentSession } from "$lib/view-models/agent-session.svelte"
import { BubblePlayer } from "$lib/view-models/bubble-player.svelte"
import { ttsCapabilities } from "$lib/view-models/capabilities.svelte"
import { CliAvailability } from "$lib/view-models/cli-availability.svelte"
import { ContentViewerVM } from "$lib/view-models/content-viewer.svelte"
import { ModelStatus } from "$lib/view-models/derived/model-status.svelte"
import { VoiceMode } from "$lib/view-models/derived/voice-mode.svelte"
import { I18nVM } from "$lib/view-models/i18n.svelte"
import { Live } from "$lib/view-models/live.svelte"
import { ComposerDraft } from "$lib/view-models/composer-draft.svelte"
import { Dictate } from "$lib/view-models/dictate.svelte"
import { Mic } from "$lib/view-models/mic.svelte"
import { ModalsVM } from "$lib/view-models/modals.svelte"
import { PresencePoller } from "$lib/view-models/presence-poller.svelte"
import { RecentProjects } from "$lib/view-models/recent-projects.svelte"
import { ResponsiveVM } from "$lib/view-models/responsive.svelte"
import { Settings } from "$lib/view-models/settings.svelte"
import { Speaker } from "$lib/view-models/speaker.svelte"
import { ThemeVM } from "$lib/view-models/theme.svelte"
import { UiShellVM } from "$lib/view-models/ui-shell.svelte"

let { children } = $props()

// ─── הגדרות ──────────────────────────────────────
// (rtl-ltr-bidi) הועבר לפני i18n — I18nVM תלוי ב-Settings עכשיו
const settings = new Settings()

// ─── i18n ──────────────────────────────────────────
// (rtl-ltr-bidi) locale נגזר מ-Settings — מקור-אמת persisted אחד
const i18n = new I18nVM({ settings })

// ─── cues ─── (slice 6 — אין תלויות חיצוניות, חייב להיות לפני session/speaker/mic)
const cues = new CuesEngine()

// ─── סשן ───────────────────────────────────────
// slice-restore-last-config: settings מוזרק לסשן כדי לשמור config פר-CLI
const session = new AgentSession({ cues, settings })

// ─── audio-playlist ─── (A4 — entity משותף בין Speaker ו-BubblePlayer)
// AudioSink נוצר כאן — Speaker מחזיק ref אליו (prepareSegment/clear).
// AudioPlaylist נוצר לפני Speaker כי Speaker מקבל אותו כ-dependency.
const sharedAudioStream = new PlayableSink()
const sharedOrderAlloc = new OrderAllocator()
const audioPlaylist = new AudioPlaylist(sharedAudioStream)

// ─── mic ─── (slice 3; voice-pending-persistence recovery)
const { micRecovery, dictateRecovery } = createPendingCaptureWiring()
const mic = new Mic({ session, cues, recovery: micRecovery })

// ─── composer-draft ─── (slice dictate-to-input)
const composerDraft = new ComposerDraft()

// ─── dictate ─── (slice dictate-to-input — תלוי ב-composerDraft + mic)
const dictate = new Dictate({ draft: composerDraft, mic, recovery: dictateRecovery })

// ─── theme ─── (redesign-1) — declared before Live getter; instance assigned below Live block
let theme!: ThemeVM

// ─── live ─── (slice live-ears — תלוי ב-mic)
const live = new Live({
  mic,
  session,
  language: i18n.locale === "he" ? "he" : "en",
  getVoiceName: () => settings.liveVoice,
  getSettings: () => settings,
  getTheme: () => theme,
})

// ─── speaker ─── (§4.3: live ref — TTS off while Live open)
const speaker = new Speaker({
  session,
  settings,
  cues,
  playlist: audioPlaylist,
  audioStream: sharedAudioStream,
  orderAlloc: sharedOrderAlloc,
  live,
})

// ─── voice-mode ─── (slice 3 — תלוי ב-mic + session + speaker + live)
const voiceMode = new VoiceMode({ mic, session, speaker, playlist: audioPlaylist, live })

// ─── model-status ─── (msr-v2 — תלוי ב-session + speaker)
const modelStatus = new ModelStatus({ session, speaker })

// ─── bubble-player ─── (msr-v2 — תלוי ב-session + settings + audioPlaylist)
// A4: playlist משותף עם Speaker — BubblePlayer יאוחד ב-Commit 3
const bubblePlayer = new BubblePlayer({
  session,
  settings,
  playlist: audioPlaylist,
  orderAlloc: sharedOrderAlloc,
})

// ─── car-mode ─── (slice 7)

theme = new ThemeVM()

// ─── responsive ─── (redesign-2)
const responsive = new ResponsiveVM()

// ─── ui-shell ─── (redesign-2)
const uiShell = new UiShellVM()

// ─── modals ─── (redesign-6)
const modals = new ModalsVM()

// ─── content-viewer ─── (slice content-viewer — בלתי-תלוי)
const contentViewer = new ContentViewerVM()

// ─── active-agents ─── (slice active-agents-widget — בלתי-תלוי)
const activeAgents = new ActiveAgents()

// ─── recent-projects ─── (slice connect-recent-projects — בלתי-תלוי)
const recentProjects = new RecentProjects()

// ─── cli-availability ─── (slice cli-branding, Commit 3 — הועבר מ-+page.svelte כדי
// שכניסה ישירה ל-/chat (רענון, deep-link) גם היא תטען את הרג'יסטרי; ר' brief §4 C3.
// load() רץ פעם אחת לכל טעינת-אפליקציה (שינוי-סמנטיקה מכוון, ר' "סטיות" בסוף המסמך).
const cliAvailability = new CliAvailability()
void cliAvailability.load()

// ─── tts-capabilities ─── (slice tts-provider-availability, Commit 3 — race-fix)
// מקדים את בדיקת הזמינות לפני שה-$effect ב-VoicePicker מופעל.
// refresh() non-blocking (void) — אין await. ה-$effect reactive ב-VoicePicker
// יתעורר אוטומטית כשcaps יתעדכן.
void ttsCapabilities.refresh()

// ─── presence-poller ─── (slice liveness C3 — חי לכל אורך הסשן, גם כשהפאנל סגור)
const presencePoller = new PresencePoller(session)
presencePoller.init()
session.bindConnectionRelease()
session.setSseReconnectedListener(() => presencePoller.onSseReconnected())
bindSessionScope({ session, speaker, orderAlloc: sharedOrderAlloc })

// ─── wake-lock ─── (Track C — drive-first chrome)
const wakeLock = new WakeLockEngine()
$effect(() => {
  wakeLock.setEnabled(settings.screenWakeLock) // קריאה ריאקטיבית של $state
  return () => wakeLock.dispose()
})

// ─── notifications ─── (slice notify-local · notify-quiet-prompt)
const notify = new NotifyEngine({ text: (kind) => notifyTexts(i18n.t, kind) })
notify.watchPermission()
$effect(() => notify.setEnabled(settings.notifications))
$effect(() => () => notify.dispose())
$effect(() => notify.notifyTurn(session.turnState))
$effect(() => notify.notifyPermissionPending(session.pendingPermission !== null))
$effect(() => notify.notifyElicitationPending(session.pendingElicitation !== null))

// ─── dir/lang sync ─── (rtl-ltr-bidi)
// סנכרון <html dir> ו-<html lang> ל-locale — הקסם של הדו-כיווניות.
// ה-effect קורא $state (i18n.locale) וכותב ל-DOM (לא ל-$state) → אין infinite loop.
// <html> אינו DOM-node של component ספציפי → layout הוא המקום הנכון (composition root).
const RTL_LOCALES: Locale[] = ["he"]
$effect(() => {
  const loc = i18n.locale // קריאה ריאקטיבית
  const dir = RTL_LOCALES.includes(loc) ? "rtl" : "ltr"
  document.documentElement.dir = dir
  document.documentElement.lang = loc
})

// ─── document title ─── (slice app-title-build-env)
// base מ-env (נצרב ב-build); fallback "Drive Coding" אם ה-var חסר (dev-server בלי FE_ENV).
const baseTitle = env.PUBLIC_APP_TITLE || "Drive Coding"
const titleContext = $derived.by(() => {
  const p = page.url.pathname
  if (p.startsWith("/settings")) return i18n.t("appTitle.settings")
  if (p.startsWith("/chat")) return session.sessionTitle?.trim() || null
  if (p === "/") return i18n.t("appTitle.sessions")
  return null
})
const docTitle = $derived(titleContext ? `${baseTitle} • ${titleContext}` : baseTitle)

// ─── session-transport override ─── (slice transport-polish C3)
// עקיפה מ-URL: ?sessionTransport=ws/http → נכתב מנורמל ל-sessionStorage (חיה בטאב).
// קריאה+נרמול+כתיבה בלבד — לא נוגע ב-attach/detach/reconnect/VM. שינוי הדגל משפיע
// על החיבור הבא בלבד; סשן חי ממשיך בטרנספורט שלו. $effect לא רץ ב-SSR → גישה לאחסון בטוחה.
$effect(() => {
  const q = page.url.searchParams.get("sessionTransport")
  const normalized = normalizeSessionTransport(q)
  if (normalized) sessionStorage.setItem("sessionTransport", normalized)
})

// ─── presence sync ─── (slice liveness C3)
// סבב-תיקונים liveness — שני תיקונים בבלוק הקטן הזה:
//
// 1. `inSession` היה `status === "connected"`. ⇒ ברגע שה-WS נפל, sync קיבל
//    `inSession:false` → stop() → clearBanner(), והבאנר נמחק **בדיוק** ברגע
//    שנועד להופיע. הבאנר לא יכול להיות בעל-הבית של מצב-החיבור אם הוא נהרס
//    בניתוק. "בסשן" = connected **או** disconnected (ניתוק חולף); "error"
//    ו-"idle" נשארים בחוץ — הראשון טרמינלי (session.error מציג אותו), השני אין בו סשן.
// 2. `return () => stop()` רץ לפני **כל** הרצה-מחדש של ה-$effect, לא רק בפירוק —
//    כלומר כל שינוי ב-status/agentId/hidden ניגב את הבאנר ואת מונה-הכשלים.
//    הפירוק עבר ל-$effect נפרד בלי קריאות ריאקטיביות, שרץ פעם אחת.
$effect(() => {
  const status = session.status
  const inSession = status === "connected" || status === "disconnected"
  const agentId = session.agentId
  const hidden = isPageHidden()
  presencePoller.sync({ inSession, agentId, hidden })
})
$effect(() => () => presencePoller.dispose())

// ─── ui-shell inputMode reset ─── (slice playback-dock-scope)
// RecordFooter mode was local $state — unmount on idle reset it. Singleton survives
// navigation; reset when agentId is set/changed (attach, new session, switch).
$effect(() => {
  const agentId = session.agentId
  if (agentId) uiShell.resetInputModeForSession()
})

// ─── חיווט ───────────────────────────────────────
setI18n(i18n)
setSettings(settings)
setCues(cues)
setSession(session)
setSpeaker(speaker)
setAudioPlaylist(audioPlaylist)
setMic(mic)
setLive(live)
setVoiceMode(voiceMode)
setModelStatus(modelStatus)
setBubblePlayer(bubblePlayer)
setTheme(theme)
setResponsive(responsive)
setUiShell(uiShell)
setModals(modals)
setContentViewer(contentViewer)
setActiveAgents(activeAgents)
setRecentProjects(recentProjects)
setCliAvailability(cliAvailability)
setPresencePoller(presencePoller)
setNotify(notify)
setComposerDraft(composerDraft)
setDictate(dictate)

// ─── chat-scroll bridge ─── (slice chat-virtualization)
const chatScroll = $state<ChatScrollBridge>({ scrollEl: null, handle: null })
setChatScroll(chatScroll)

// ─── DEV-only: חשיפת ה-session ל-window לצורך חילוץ fixtures ודיבוג עיצוב ───
if (import.meta.env.DEV && typeof window !== "undefined") {
  // biome-ignore lint/suspicious/noExplicitAny: dev debug hook
  ;(window as any).__session = session
}

// ─── slice debug-surface: משטח-תצפית ב-dev **וגם בפריוויו** ───
// הגייט הוא PUBLIC_APP_ENV (מ-FE_ENV בזמן-בילד) ולא import.meta.env.DEV,
// שהוא false בכל בילד — בדיוק הסיבה שה-hook שמעל חסר-תועלת בפריוויו.
// slice playback-observability: הגייט הוא **או** בזמן-בילד **או** דגל-ריצה.
// ⚠️ הדגל נחוץ דווקא בייצור: הבאגים שנתפסים בשדה (הקראה שנפסקת אחרי תור
// שלם) אינם מופיעים ב-dev, ובלי משטח-תצפית מאבחנים אותם בעיוורון. הקוד
// זעיר, המשטח קריא-בלבד, והנתונים סגורים עד ש-`__dc.enable()` נקרא.
const dcOptIn = typeof localStorage !== "undefined" && localStorage.getItem("__dc") === "1"
if (__DC_ENABLED__ || dcOptIn) {
  void installDebugSurface()
}

// ─── pending-capture ─── (slice voice-pending-persistence)
onMount(() => {
  void mic.hydratePending()
  void dictate.hydratePending()
})

// ─── config-change-socket ─── (slice cli-specs-hot-reload)
// Wiring only: the socket, lifecycle and reconnect live in the engine (golden rule
// forbids WebSocket in routes). Here we only create it and pass the callback.
const configSocket = createConfigChangeSocket({
  url: beWsUrl("/ws/echo"),
  onConfigChanged: () => void cliAvailability.reload(),
})
onMount(() => configSocket.start())
onDestroy(() => configSocket.stop())
</script>

<svelte:head>
  <title>{docTitle}</title>
</svelte:head>

{@render children?.()}

<!-- ─── slice playback-observability ───
     ⚠️ אחרי ה-children, מחוץ לכל מכל — `position: fixed` בתוך מכל עם
     `transform`/`filter` היה נצמד למכל ולא ל-viewport. -->
{#if __DC_ENABLED__ || dcOptIn}
  <PlaybackDebugPanel />
{/if}
