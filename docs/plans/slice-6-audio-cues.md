# Slice 6 — Audio Cues — תוכנית

> **תאריך**: 2026-05-29
> **סטטוס**: ‏ממתינה ל-dispatch (אחרי תיקוני אביגיל)
> **Complexity**: 3/10 (verifier: light)
> **תלות**: ‏dev tip. ‏הCues engine + ‏VM ‏עצמאיים. (אביגיל: ‏dev כבר כולל מבנה של slice 3, הbrief תואם).
> **מתבסס על**: ‏`docs/plans/README.md` (מבנה), ‏`docs/conventions/parallel-safe-code.md` (additive), ‏`docs/frontend-spec.md §10` (cue specs)

---

## §0 — Pre-flight

### Worktree

```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/slice-6-audio-cues -b slice-6-audio-cues dev
cd .worktrees/slice-6-audio-cues
pnpm install
pnpm hooks:install
```

### Ports — ‏worktree ‏שלישי

‏ה-slice הזה ‏יכול לרוץ ‏במקביל ‏ל-slice 3 ‏ו-slice 11 ‏שכבר בעבודה. ‏לפי `AGENTS.md §Running parallel worktrees`:
- ‏slice 3 (worktree A) — ‏BE port 4000, ‏FE default
- ‏slice 11 (worktree B) — ‏BE port 4001, ‏FE BE_PORT=4001
- ‏**slice 6 (worktree C — ‏זה)** — ‏BE port 4002, ‏FE BE_PORT=4002

### איך להריץ

| ‏מה | ‏פקודה |
|---|---|
| ‏BE (אם נדרש לבדיקה) | `cd packages/backend && PORT=4002 onecli run --agent voice-acp -- bun --watch src/server.ts` |
| ‏FE | `BE_PORT=4002 pnpm --filter @drive-coding/frontend-v2 dev` |

‏**הערה**: ‏הCues engine ‏לא ‏עושה ‏קריאות ‏API ‏(Web Audio בלבד). ‏BE+OneCLI ‏לא ‏חיוניים ‏לפיתוח, ‏רק לבדיקה ידנית כללית של ה-app.

### Browser

‏Chrome רגיל מקומי. ‏Web Audio API ‏עובד בכל ‏הbrowsers ‏המודרניים.

**Critical**: ‏AudioContext דורש user gesture. ‏לא יוצרים אותו עד הקריאה הראשונה ל-`play()`. ‏אחרת — ‏Chrome ‏יחסום עם warning ‏ב-console ‏("AudioContext was not allowed to start").

### Reading list

**must-read לפני** (~‎10 ‏דקות):

1. ‏`docs/conventions/parallel-safe-code.md` §1, §2 — ‏additive vs invasive
2. ‏`packages/frontend/AGENTS.md` — ‏5 חוקי זהב + ‏מבנה 5 שכבות
3. ‏`docs/frontend-spec.md §10` — ‏טבלת ‏5 ‏cues + ‏specs (frequencies + ‏durations)
4. ‏`AGENTS.md` (root) §Worktrees, §Ports + §Running parallel worktrees

**reference**:

- ‏`packages/frontend/src/lib/engines/recorder.ts` — ‏דוגמה ‏לengine ‏ב-FE ‏עם ‏browser APIs
- ‏`packages/frontend/src/lib/view-models/i18n.svelte.ts` — ‏דוגמה ‏ל-VM ‏עם ‏$state ‏פשוט
- ‏`~/.config/opencode/learnings.md` — ‏gotchas רוחביים

---

## §1 — מטרה

‏אחרי slice 6: ‏ה-app ‏יודע ‏לנגן ‏5 ‏צלילים קצרים מסונתזים ‏על-ידי קריאה ל-`cues.play("recordingStart")`. ‏הצלילים נשמעים נכון (frequencies + ‏durations ‏לפי spec).

**‏לא ‏בscope**: ‏integration אוטומטית ‏עם VoiceMode (לחיצה ‏על ‏cue ‏בכל state transition). ‏זה ‏ידרוש ‏את ‏VoiceMode מ-slice 3 ‏וייעשה ‏ב-follow-up ‏קצר אחרי ‏ש-slice 3 ‏ייושב ל-dev. ‏ב-slice 6 ‏עצמו — ‏ה-engine + ‏VM ‏עומדים בפני עצמם, ‏ניתנים ‏לקריאה ‏ידנית.

‏אישה ‏אחרי slice 6 + ‏follow-up: ‏לוחצת ‏על ‏Mic → ‏שומעת ‏ping קצר ‏(A5). ‏מסיימת ‏לדבר → ‏ping אחר (E5). ‏הסוכן ‏חושב → ‏צליל ‏עולה. ‏מתחיל ‏לדבר → ‏צליל ‏יורד. ‏בעיה → ‏צליל ‏שגיאה ‏מאיים. ‏זה ‏מאפשר ‏לה ‏לדעת ‏מה ‏קורה ‏מבלי ‏להסתכל ‏על המסך — ‏drive-first.

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|---|---|---|
| ‏CuesEngine ‏(Web Audio oscillator) | ✅ | ‏commit 0 |
| ‏5 ‏cues לפי spec | ✅ | ‏commit 0 |
| ‏Lazy AudioContext (user gesture) | ✅ | ‏commit 0 |
| ‏enabled toggle ‏על engine | ✅ | ‏commit 0 |
| ‏Context + ‏layout wiring | ✅ | ‏commit 1 |
| ‏Manual test page לאישוש ‏שמיעתי | 🟡 | ‏commit 2 (אופציונלי, ‏לפיתוח) |
| ‏Integration עם VoiceMode (auto-trigger) | ❌ | ‏follow-up אחרי slice 3 merge |
| ‏Volume control / ‏per-cue mute | ❌ | ‏slice 9 (Settings) |
| ‏Custom cue sounds (uploaded files) | ❌ | ‏future |

---

## §3 — Architecture

```
+layout.svelte
  ├─ new I18nVM()
  ├─ new Settings()
  ├─ new AgentSession()
  ├─ new Speaker({ session, settings })
  └─ new CuesEngine()                       ← ‏חדש (engine, ‏לא VM)
        │
        │  Lazy: ‏AudioContext נוצר ‏ב-play() ‏הראשון
        │  enabled: boolean
        │  play(cue: CueId): void           ← ‏API ‏יחיד
        │
        ├─ recordingStart    A5 (880Hz) ‏פר 120ms
        ├─ recordingStop     E5 (660Hz) ‏פר 120ms
        ├─ thinking          C5→E5 rising ‏פר 300ms
        ├─ speaking          E5→C5 falling ‏פר 300ms
        └─ error             E4→A3 ‏פר 400ms

‏קריאות עתידיות (לא ב-slice 6):
  Mic VM ‏(slice 3 → ‏merged) — ‏cues.play("recordingStart") ‏ב-toggle()
  Speaker VM — ‏cues.play("speaking") ‏ב-first segment
  VoiceMode — ‏cues.play("error") ‏ב-status transition ‏ל-error
```

‏קבצים ‏חדשים:
- ‏`packages/frontend/src/lib/engines/cues.ts` — ‏הengine
- ‏`packages/frontend/src/lib/engines/cues.test.ts` — ‏tests structural

‏קבצים ‏שמשתנים ‏(כל אחד **additive** ‏לפי `parallel-safe-code.md`):

| ‏קובץ | ‏שינוי | ‏סוג |
|---|---|---|
| ‏`packages/frontend/src/lib/context.ts` | ‏הוסף ‏section ‏חדש `// ─── cues ───` ‏בסוף ‏הקובץ ‏(בקובץ ‏הנוכחי ‏יש ‏stubs ‏ל-mic, ‏voice-mode, ‏car-mode — ‏cues ‏אינו ‏מסומן ‏עדיין). ‏הסעיף ‏יכלול: ‏`import type { CuesEngine } from "./engines/cues"` + ‏`export const [getCues, setCues] = createContext<CuesEngine>()` | Additive |
| ‏`packages/frontend/src/routes/+layout.svelte` | ‏ב-section ‏חדש `// ─── cues ───`: ‏`const cues = new CuesEngine()` + ‏imports. ‏ב-wiring block: ‏`setCues(cues)` | Additive |

‏שום ‏שינוי ‏בקבצים ‏אחרים. ‏אין UI חדש ‏ב-slice 6 ‏(test page ‏ב-commit 2 ‏אופציונלי).

---

## §4 — Commits

### Commit 0 — CuesEngine + ‏tests (approach: **TDD**)

‏לוגיקה ‏טהורה ‏ב-engine + ‏tests מסומנים — ‏TDD ‏מתאים.

**קבצים ‏חדשים**:
- ‏`packages/frontend/src/lib/engines/cues.ts`
- ‏`packages/frontend/src/lib/engines/cues.test.ts`

**API skeleton**:

```ts
/**
 * CuesEngine — synthesises short audio cues via Web Audio API.
 *
 * 5 cue types per frontend-spec §10. AudioContext is created lazily on
 * the first play() call (browsers require user gesture before creation).
 *
 * Once created, the context stays alive — subsequent plays reuse it.
 */
export type CueId =
  | "recordingStart"
  | "recordingStop"
  | "thinking"
  | "speaking"
  | "error"

export class CuesEngine {
  enabled: boolean = true  // slice 9 ‏יקשור ‏ל-Settings

  #ctx: AudioContext | null = null

  /**
   * Play a cue. ‏No-op אם enabled=false ‏או ‏אם AudioContext ‏לא יכול להיווצר
   * ‏(לדוגמה ‏ב-SSR או ‏אם ‏ה-browser ‏חוסם). ‏אף ‏פעם ‏לא ‏זורק.
   */
  play(cue: CueId): void

  /** ‏Cleanup, ‏לקריאה ‏ב-destroy ‏של layout (ייתכן). */
  close(): Promise<void>
}
```

**Implementation pattern** (פסאודו):

```
play(cue):
  if (!enabled) return
  if (typeof AudioContext === "undefined") return  // SSR
  if (!#ctx) {
    try { #ctx = new AudioContext() }
    catch { return }  // ‏browser ‏חסם
  }
  if (#ctx.state === "suspended") {
    void #ctx.resume()
  }
  switch (cue):
    case "recordingStart": playTone(880, 120)
    case "recordingStop":  playTone(660, 120)
    case "thinking":       playGlide(523, 659, 300)  // C5 → E5
    case "speaking":       playGlide(659, 523, 300)  // E5 → C5
    case "error":          playGlide(329, 220, 400)  // E4 → A3 (אזעקה ‏יורדת)

playTone(freq, ms):
  const t = #ctx.currentTime
  const osc = #ctx.createOscillator()
  const gain = #ctx.createGain()
  osc.frequency.value = freq
  osc.type = "sine"
  gain.gain.setValueAtTime(0, t)
  gain.gain.linearRampToValueAtTime(0.2, t + 0.005)  // fast attack
  gain.gain.linearRampToValueAtTime(0, t + ms / 1000)  // decay
  osc.connect(gain).connect(#ctx.destination)
  osc.start(t)
  osc.stop(t + ms / 1000 + 0.05)

playGlide(fromFreq, toFreq, ms):
  const t = #ctx.currentTime
  const osc = #ctx.createOscillator()
  const gain = #ctx.createGain()
  osc.frequency.setValueAtTime(fromFreq, t)
  osc.frequency.linearRampToValueAtTime(toFreq, t + ms/1000)
  // ... rest same as playTone (gain setup, connect, start/stop)
```

**Tests** (structural — ‏בדיקת shape, ‏לא ‏שמע ‏בפועל):

1. ‏`new CuesEngine()` ‏יוצר instance ‏עם enabled=true ‏ו-#ctx=null
2. ‏`play("recordingStart")` ‏לא ‏זורק ‏אם ‏ה-AudioContext ‏זמין ‏(mock עם vi.stubGlobal)
3. ‏`play("invalid" as CueId)` ‏בTS ‏ייבכה ‏ב-typecheck — ‏לא צריך runtime check
4. ‏`enabled = false` + ‏`play(...)` ‏= ‏no-op (‏לא ‏יוצר AudioContext)
5. ‏`play` ‏ראשון ‏יוצר ‏AudioContext, ‏שני משתמש ‏באותו
6. ‏SSR safety: ‏`vi.stubGlobal("AudioContext", undefined)` ‏+ ‏`play(...)` ‏= ‏no-op, ‏לא זורק
7. ‏`close()` ‏סוגר את ‏ה-AudioContext (אם קיים)

**Verification**:

```bash
pnpm --filter @drive-coding/frontend-v2 test
# ‏או ‏ידנית: ‏npx vitest run packages/frontend/src/lib/engines/cues.test.ts
pnpm --filter @drive-coding/frontend-v2 typecheck
```

**‏הערה**: ‏ה-vitest config של FE ‏הוקם ‏מראש ‏ב-`packages/frontend/vitest.config.ts` ‏(מצא ‏אותו ‏ב-dev tip). ‏ה-glob ‏כולל ‏`**/*.{test,spec}.{ts,svelte.ts}` — ‏הקובץ ‏`cues.test.ts` ‏נתפס ‏אוטומטית. ‏Tests ‏ירוצו ‏ב-environment ‏node + ‏stub ‏ל-`AudioContext` ‏עם ‏`vi.stubGlobal`.

---

### Commit 1 — Context + ‏layout wiring (approach: **manual**)

‏Integration ‏טריוויאלי. ‏מוסיף ‏את ‏ה-CuesEngine ‏ל-app singletons.

**קבצים שמשתנים**:

| ‏קובץ | ‏שינוי |
|---|---|
| ‏`packages/frontend/src/lib/context.ts` | ‏הוסף section ‏חדש ‏`// ─── cues ───` ‏בסוף ‏הקובץ ‏(אין stub ‏קיים): ‏`import type { CuesEngine } from "./engines/cues"` + ‏`export const [getCues, setCues] = createContext<CuesEngine>()` |
| ‏`packages/frontend/src/routes/+layout.svelte` | ‏הוסף ‏section ‏חדש ‏`// ─── cues ───`: ‏`const cues = new CuesEngine()`. ‏ב-wiring block: ‏`setCues(cues)`. ‏imports למעלה |

**Verification**:

```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm --filter @drive-coding/frontend-v2 build
pnpm lint:i18n
```

‏ידני: ‏typecheck + build ‏ירוקים = ‏הtyping ‏של ‏ה-context ‏נכון, ‏ה-engine ‏מחובר. ‏בדיקה שמיעתית ‏אמיתית ‏תהיה ‏רק ‏אחרי ‏ה-integration ‏עם ‏VoiceMode (post-slice 3).

---

### Commit 2 — walkthrough + ‏cleanup (approach: **manual**)

‏החלטה: **‏אין** ‏manual test surface ‏ב-slice 6 ‏עצמו. ‏Verification ‏שמיעתית ‏תידחה ‏ל-follow-up ‏שמחבר ‏ל-VoiceMode (אחרי slice 3 ‏merge). ‏סיבה: ‏הוספת ‏query-param ‏בroute קיים ‏או ‏route ‏ייעודי — ‏שניהם ‏פולשניים ‏יחסית ‏לערך שמתקבל, ‏וtests ‏ב-vitest ‏מבטיחים ‏ש-API ‏נכון.

**קבצים ‏שמשתנים**:
- ‏`docs/walkthrough.md`
- ‏`packages/frontend/docs/slices.md` — ‏status 💭 → ✅ ‏(חלקי — ‏engine ‏מוכן, ‏integration ‏ב-follow-up)
- ‏`docs/plans/slice-6-audio-cues.md` (זה) — ‏סטטוס → "‏הושלם — engine; integration pending"

**‏follow-up entry ‏ב-walkthrough**: ‏"‏integration ‏של ‏cues ‏עם ‏VoiceMode דורש slice 3 — ‏יבוצע ‏בנפרד".

---

## §5 — DoD

| # | ‏בדיקה | ‏איך |
|---|---|---|
| 1 | ‏`new CuesEngine()` ‏לא ‏יוצר ‏AudioContext ‏עד ‏`play()` ‏ראשון | ‏Test ‏בpacket vitest |
| 2 | ‏`play("recordingStart")` ‏יוצר AudioContext, ‏מנגן צליל ‏(structural — ‏oscillator.start נקרא) | ‏Test |
| 3 | ‏`enabled = false` → ‏`play()` ‏הוא ‏no-op (אין AudioContext, ‏אין oscillator) | ‏Test |
| 4 | ‏SSR safety: ‏`typeof AudioContext === "undefined"` → ‏play ‏לא זורק | ‏Test ‏עם stubGlobal |
| 5 | ‏typecheck + build + tests | ‏ראה §4 |
| 6 | ‏i18n lint | `pnpm lint:i18n` |
| 7 | ‏`getCues()` ‏מתפקד ‏בcomponent שמשתמש ‏ב-context | ‏build success ‏מעיד ‏על typing |
| 8 | ‏(אופציונלי) ‏שמיעתי: ‏ב-`?cues=test` ‏או ‏manual context call, ‏הצלילים נשמעים נכון | ‏ידני ב-browser |
| 9 | ‏ה-smoke tests הקיימים ‏לא נשברו | ‏`tests/smoke/run-all.mjs` |

---

## §6 — Risks + ‏mitigations

| # | ‏סיכון | ‏מקור | ‏מיטיגציה |
|---|---|---|---|
| 1 | ‏AudioContext autoplay policy | ‏Chrome >= 71 | ‏lazy creation ‏ב-`play()` ‏הראשון (אחרי ‏user gesture) |
| 2 | ‏SSR crashes | ‏`AudioContext` ‏לא קיים ‏ב-Node | ‏`typeof AudioContext === "undefined"` guard ‏ב-play |
| 3 | ‏ה-tones ‏צורמים / ‏לא נשמעים כצפוי | ‏subjective — ‏specs ‏ב-spec doc | ‏רק אחרי שמיעתי. ‏אם נדרש tweaking — ‏ב-follow-up ‏אחרי VoiceMode integration |
| 4 | ‏webkit ‏ישן (iOS Safari < 14) | ‏prefixed `webkitAudioContext` | ‏MVP: ‏לא תומכים. ‏אם נדרש ‏- ‏future. ‏אזכרה ‏ב-fallback: ‏`(window.AudioContext ?? (window as any).webkitAudioContext)` |
| 5 | ‏i18n: ‏Hebrew ב-cue ‏labels ‏(אם נוסיפ) | ‏i18n-gap | ‏ב-MVP — ‏cue IDs ‏באנגלית, ‏אין UI strings. ‏לא חוסם |
| 6 | ‏Svelte 5 reactivity על enabled | ‏general | ‏אם נוסיף `$state` ‏(slice 9 ‏יחבר Settings), ‏זה מקרה תקני. ‏ב-MVP — ‏plain boolean ‏מספיק |
| 7 | ‏ה-tests דורשים stubGlobal של AudioContext | ‏vitest node env | ‏פטרן ‏ידוע (slice testing-coverage השתמש ב-stubGlobal ל-localStorage). ‏אפשר ‏לחקות |

---

## §7 — Escalation triggers

‏עצור ‏ושאל את Tama אם:

1. ‏ה-AudioContext mock ‏ב-vitest ‏מסובך ‏מדי ‏(הtests ‏לוקחים ‏יותר מ-20 ‏דק' לעבוד) — ‏אולי ‏לפשט ‏ל-smoke בלבד.
2. ‏ה-integration ‏לא ‏triviale — ‏אם ‏מבנה ‏של VoiceMode ‏(שאמור להגיע ‏מ-slice 3) ‏סותר ‏את ‏ההנחות ‏פה. ‏ה-slice 6 ‏לא ‏אמור ‏לטפל ‏ב-integration ‏אבל ‏אם executor רואה ‏בעיה ‏מבנית — ‏לעצור.

‏אחרת: ‏החלט סבירות, ‏רשום בcommit message, ‏המשך.

---

## §8 — Complexity score: 3/10

| ‏פקטור | ‏ניקוד |
|---|---|
| ‏מספר commits (2-3) | ‏נמוך |
| ‏שכבות חדשות (engine ‏בלבד) | +1 |
| ‏APIs חיצוניים | 0 |
| ‏Browser APIs (Web Audio) | +1 |
| ‏Streaming pipeline | 0 |
| ‏Refactor של state | 0 |
| ‏שינוי protocol BE↔FE | 0 |
| ‏Integration ‏עם VMs ‏אחרים | 0 (לא ‏ב-scope) |
| ‏סה"כ | **3** |

**Verifier**: ‏`verifier-slice-light` ‏בלבד. ‏אין ‏phase verifier — ‏הslice קטן מספיק.

---

## §9 — שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|---|---|---|
| 1 | ‏גלים rising/falling — ‏linear ‏או exponential ramp? | ‏linear (פשוט יותר). ‏אם נשמע מכאני — ‏tweaking ב-follow-up | ❌ |
| 2 | ‏Sine wave רגיל — ‏או ‏ענפים ‏יותר (square, ‏triangle)? | ‏Sine (פשוט, ‏טוב לcues קצרים) | ❌ |
| 3 | ‏Volume — ‏0.2 ‏gain | ‏לא בוזק מדי, ‏לא ‏שקט. ‏slice 9 ‏יוסיף ‏slider | ❌ |
| 4 | ‏Webkit prefix ‏fallback ל-iOS ‏ישן | ‏לא ‏תומכים ‏ב-MVP. ‏slice עתידי | ❌ |

---

## §10 — מה אחרי slice 6

‏ה-engine ‏מוכן ‏אבל ‏לא מנוצל ‏אוטומטית. ‏ה-integration ‏עם VoiceMode ‏ידרוש:

1. ‏לחכות ‏שslice 3 ‏(Mic + ‏VoiceMode FSM) ‏יושב ל-dev
2. ‏commit ‏קצר ‏(~‎50 ‏שורות) ‏שמוסיף ‏`$effect` ‏ב-`+layout.svelte` ‏(או ‏ב-Cues VM ‏חדש) ‏שעוקב ‏אחרי `voiceMode.state` ‏ומפעיל ‏את ‏ה-cue ‏המתאים ‏ב-transitions:
   - ‏`idle → recording` → ‏`cues.play("recordingStart")`
   - ‏`recording → transcribing` → ‏`cues.play("recordingStop")`
   - ‏`transcribing → thinking` → ‏`cues.play("thinking")`
   - ‏`thinking → speaking` → ‏`cues.play("speaking")`
   - ‏`* → error` → ‏`cues.play("error")`

‏ה-integration ‏צריך ‏להיות ‏ב-section ‏ייעודי ‏ב-+layout (לפי ‏parallel-safe), ‏או ‏ב-Cues VM ‏שיוצר ‏עם ‏`{voiceMode}` ‏dep.

‏מה ‏עוד ‏עתידי:
- ‏slice 9 (Settings page) — ‏toggle ‏לכל cue + ‏volume slider + ‏פר-cue mute
- ‏slice 7 (car mode) — ‏startup chime ‏שונה ‏(A5 → ‏E6)
- ‏Custom cue sounds (uploaded WAV files) — ‏future
