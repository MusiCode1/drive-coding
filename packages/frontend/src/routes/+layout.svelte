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
import type { Locale } from "@drive-coding/core/i18n"
import {
  setActiveAgents,
  setBubblePlayer,
  setCues,
  setI18n,
  setMic,
  setModals,
  setModelStatus,
  setResponsive,
  setSession,
  setSettings,
  setSpeaker,
  setTheme,
  setUiShell,
  setVoiceMode,
} from "$lib/context"
import { CuesEngine } from "$lib/engines/cues"
import { WakeLockEngine } from "$lib/engines/wake-lock"
import { ActiveAgents } from "$lib/view-models/active-agents.svelte"
import { AgentSession } from "$lib/view-models/agent-session.svelte"
import { BubblePlayer } from "$lib/view-models/bubble-player.svelte"
import { ModelStatus } from "$lib/view-models/derived/model-status.svelte"
import { VoiceMode } from "$lib/view-models/derived/voice-mode.svelte"
import { I18nVM } from "$lib/view-models/i18n.svelte"
import { Mic } from "$lib/view-models/mic.svelte"
import { ModalsVM } from "$lib/view-models/modals.svelte"
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
const session = new AgentSession({ cues })

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

// ─── active-agents ─── (slice active-agents-widget — בלתי-תלוי)
const activeAgents = new ActiveAgents()

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
setActiveAgents(activeAgents)

// ─── DEV-only: חשיפת ה-session ל-window לצורך חילוץ fixtures ודיבוג עיצוב ───
if (import.meta.env.DEV && typeof window !== "undefined") {
  // biome-ignore lint/suspicious/noExplicitAny: dev debug hook
  ;(window as any).__session = session
}
</script>

{@render children?.()}
