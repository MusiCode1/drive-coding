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
import { setCues, setI18n, setMic, setSession, setSettings, setSpeaker, setVoiceMode } from "$lib/context"
import { CuesEngine } from "$lib/engines/cues"
import { AgentSession } from "$lib/view-models/agent-session.svelte"
import { I18nVM } from "$lib/view-models/i18n.svelte"
import { Mic } from "$lib/view-models/mic.svelte"
import { Settings } from "$lib/view-models/settings.svelte"
import { Speaker } from "$lib/view-models/speaker.svelte"
import { VoiceMode } from "$lib/view-models/derived/voice-mode.svelte"

let { children } = $props()

// ─── i18n ──────────────────────────────────────────
const i18n = new I18nVM()

// ─── הגדרות ──────────────────────────────────────
const settings = new Settings()

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

// ─── car-mode ─── (slice 7)

// ─── חיווט ───────────────────────────────────────
setI18n(i18n)
setSettings(settings)
setCues(cues)
setSession(session)
setSpeaker(speaker)
setMic(mic)
setVoiceMode(voiceMode)
</script>

{@render children?.()}
