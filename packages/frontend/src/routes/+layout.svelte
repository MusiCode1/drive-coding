<script lang="ts">
/**
 * Composition root — מאתחל (instantiates) את כל ה-view-models הראשיים ומחבר
 * אותם לקונטקסט. זהו המקום היחיד באפליקציה שבו קוראים ל-`new <VM>()`.
 *
 * ─── עיצוב תוספתי בטוח למקביליות (docs/conventions/parallel-safe-code.md) ───
 *
 * הוספת VM חדש:
 *   1. הוסף `import { Foo } from "$lib/view-models/foo.svelte"` לייבואים.
 *   2. הוסף בלוק `// ─── <domain> ───` חדש באזור למטה.
 *      לסדר יש חשיבות רק כאשר VM תלוי באחר (הצהר קודם על תלויות).
 *   3. הוסף `setFoo(foo)` בבלוק ה-setContext המתאים.
 *
 * שני slices שמוסיפים VMs בלתי תלויים ייפלו בחלקים שונים → ויעברו git auto-merge.
 */
import "../app.css"
import { page } from "$app/state"
import { env } from "$env/dynamic/public"
import type { Locale } from "@drive-coding/core/i18n"
import {
  setActiveAgents,
  setBubblePlayer,
  setChatScroll,
  setCliAvailability,
  setContentViewer,
  setCues,
  setI18n,
  setMic,
  setModals,
  setModelStatus,
  setRecentProjects,
  setResponsive,
  setSession,
  setSettings,
  setSpeaker,
  setTheme,
  setUiShell,
  setVoiceMode,
} from "$lib/context"
import type { ChatScrollBridge } from "$lib/types/chat-scroll"
import { CuesEngine } from "$lib/engines/cues"
import { WakeLockEngine } from "$lib/engines/wake-lock"
import { ActiveAgents } from "$lib/view-models/active-agents.svelte"
import { CliAvailability } from "$lib/view-models/cli-availability.svelte"
import { RecentProjects } from "$lib/view-models/recent-projects.svelte"
import { AgentSession } from "$lib/view-models/agent-session.svelte"
import { BubblePlayer } from "$lib/view-models/bubble-player.svelte"
import { ModelStatus } from "$lib/view-models/derived/model-status.svelte"
import { VoiceMode } from "$lib/view-models/derived/voice-mode.svelte"
import { I18nVM } from "$lib/view-models/i18n.svelte"
import { Mic } from "$lib/view-models/mic.svelte"
import { ContentViewerVM } from "$lib/view-models/content-viewer.svelte"
import { ModalsVM } from "$lib/view-models/modals.svelte"
import { ResponsiveVM } from "$lib/view-models/responsive.svelte"
import { Settings } from "$lib/view-models/settings.svelte"
import { Speaker } from "$lib/view-models/speaker.svelte"
import { ThemeVM } from "$lib/view-models/theme.svelte"
import { ttsCapabilities } from "$lib/view-models/capabilities.svelte"
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

// ─── speaker ─── (תלוי ב-session + settings + cues)
const speaker = new Speaker({ session, settings, cues })

// ─── mic ─── (slice 3 — תלוי ב-session + cues)
const mic = new Mic({ session, cues })

// ─── voice-mode ─── (slice 3 — תלוי ב-mic + session + speaker)
const voiceMode = new VoiceMode({ mic, session, speaker })

// ─── model-status ─── (msr-v2 — תלוי ב-session + speaker)
const modelStatus = new ModelStatus({ session, speaker })

// ─── bubble-player ─── (msr-v2 — תלוי ב-session + settings)
const bubblePlayer = new BubblePlayer({ session, settings })

// ─── car-mode ─── (slice 7)

// ─── theme ─── (redesign-1)
const theme = new ThemeVM()

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

// ─── wake-lock ─── (Track C — drive-first chrome)
const wakeLock = new WakeLockEngine()
$effect(() => {
  wakeLock.setEnabled(settings.screenWakeLock) // קריאה ריאקטיבית של $state
  return () => wakeLock.dispose()
})

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

// ─── חיווט ───────────────────────────────────────
setI18n(i18n)
setSettings(settings)
setCues(cues)
setSession(session)
setSpeaker(speaker)
setMic(mic)
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

// ─── chat-scroll bridge ─── (slice chat-virtualization)
const chatScroll = $state<ChatScrollBridge>({ scrollEl: null, handle: null })
setChatScroll(chatScroll)

// ─── DEV-only: חשיפת ה-session ל-window לצורך חילוץ fixtures ודיבוג עיצוב ───
if (import.meta.env.DEV && typeof window !== "undefined") {
  // biome-ignore lint/suspicious/noExplicitAny: dev debug hook
  ;(window as any).__session = session
}
</script>

<svelte:head>
  <title>{docTitle}</title>
</svelte:head>

{@render children?.()}
