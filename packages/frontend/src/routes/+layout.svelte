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
import { setI18n, setMic, setModals, setResponsive, setSession, setSettings, setSpeaker, setTheme, setUiShell, setVoiceMode } from "$lib/context"
import { AgentSession } from "$lib/view-models/agent-session.svelte"
import { I18nVM } from "$lib/view-models/i18n.svelte"
import { Mic } from "$lib/view-models/mic.svelte"
import { ResponsiveVM } from "$lib/view-models/responsive.svelte"
import { Settings } from "$lib/view-models/settings.svelte"
import { Speaker } from "$lib/view-models/speaker.svelte"
import { ThemeVM } from "$lib/view-models/theme.svelte"
import { UiShellVM } from "$lib/view-models/ui-shell.svelte"
import { VoiceMode } from "$lib/view-models/derived/voice-mode.svelte"
import { ModalsVM } from "$lib/view-models/modals.svelte"

let { children } = $props()

// ─── i18n ──────────────────────────────────────────
const i18n = new I18nVM()

// ─── הגדרות ──────────────────────────────────────
const settings = new Settings()

// ─── סשן ───────────────────────────────────────
const session = new AgentSession()

// ─── speaker ─── (תלוי ב-session + settings)
const speaker = new Speaker({ session, settings })

// ─── mic ─── (slice 3 — תלוי ב-session)
const mic = new Mic({ session })

// ─── voice-mode ─── (slice 3 — תלוי ב-mic + session + speaker)
const voiceMode = new VoiceMode({ mic, session, speaker })

// ─── car-mode ─── (slice 7)

// ─── theme ─── (redesign-1)
const theme = new ThemeVM()

// ─── responsive ─── (redesign-2)
const responsive = new ResponsiveVM()

// ─── ui-shell ─── (redesign-2)
const uiShell = new UiShellVM()

// ─── modals ─── (redesign-6)
const modals = new ModalsVM()

// ─── חיווט ───────────────────────────────────────
setI18n(i18n)
setSettings(settings)
setSession(session)
setSpeaker(speaker)
setMic(mic)
setVoiceMode(voiceMode)
setTheme(theme)
setResponsive(responsive)
setUiShell(uiShell)
setModals(modals)

// ─── DEV-only: חשיפת ה-session ל-window לצורך חילוץ fixtures ודיבוג עיצוב ───
if (import.meta.env.DEV && typeof window !== "undefined") {
  // biome-ignore lint/suspicious/noExplicitAny: dev debug hook
  ;(window as any).__session = session
}
</script>

{@render children?.()}
