# Slice 6 — Audio Cues — תוכנית

> **תאריך**: 2026-05-29 (שוכתב 2026-06-01 — owner-driven, אחרי merge של slice 3)
> **סטטוס**: ‏מאושר (plan-verified ✅ — אביגיל READY סבב 3, 2026-06-01). ‏ממתין ל-dispatch.
> **Complexity**: 4-5/10 (verifier: calev light)
> **depends_on**: [3]  ✅ slice 3 (Mic + VoiceMode FSM) כבר merged ל-dev
> **base**: dev (tip `56139d7` — slice 22+23 merged; ה-worktree נגזר מ-dev. 12 שורות ה-status writes לא הושפעו)
> **מתבסס על**: ‏`docs/frontend-spec.md §10` (cue specs), ‏`packages/frontend/AGENTS.md` (5 חוקי זהב), ‏`docs/conventions/parallel-safe-code.md` (additive)

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

### Ports

‏אין worktrees מתחרים כרגע → BE port 4000 (default), FE port OS-assigned.

| ‏מה | ‏פקודה |
|---|---|
| ‏BE (לבדיקה ידנית כללית) | `cd packages/backend && onecli run --agent voice-acp -- bun --watch src/server.ts` |
| ‏FE | `pnpm --filter @drive-coding/frontend-v2 dev` |
| ‏tests | `pnpm --filter @drive-coding/frontend-v2 test` |
| ‏typecheck | `pnpm --filter @drive-coding/frontend-v2 typecheck` |
| ‏build | `pnpm --filter @drive-coding/frontend-v2 build` |
| ‏i18n lint | `pnpm lint:i18n` |

> ‏**הערה על שם ה-package**: ‏ה-`package.json` של ה-FE עדיין `@drive-coding/frontend-v2`
> ‏(ה-cutover לשם `frontend` הוא slice 13). ‏ה-AGENTS.md כבר כתוב עם השם העתידי `frontend`
> ‏— ‏אבל **‏לפקודות `pnpm --filter` השתמש ב-`frontend-v2`** (השם בפועל ב-package.json).

### Browser

‏Chrome רגיל מקומי. ‏Web Audio API עובד בכל הbrowsers המודרניים.

**Critical**: ‏AudioContext דורש user gesture. ‏לא יוצרים אותו עד הקריאה הראשונה ל-`play()`.
‏אחרת Chrome חוסם עם warning ב-console ("AudioContext was not allowed to start").
‏הקריאה הראשונה ל-`cues.play()` תמיד מגיעה מתוך click על MicButton (recordingStart) —
‏כלומר אחרי user gesture. ✅

### OneCLI agent

- ‏שם: `voice-acp`
- ‏שימוש: ‏רק לבדיקה ידנית כללית של ה-app. **‏ה-CuesEngine לא עושה קריאות API** (Web Audio בלבד).
  ‏BE+OneCLI לא חיוניים לפיתוח ה-slice הזה.

### Reading list

**must-read לפני** (~‎10 דקות):

1. ‏`packages/frontend/AGENTS.md` — ‏5 חוקי זהב + מבנה 5 שכבות. **‏במיוחד חוק #4** (side effects שייכים ל-owner של ה-state).
2. ‏`docs/frontend-spec.md §10` — ‏טבלת 5 ה-cues (frequencies + durations).
3. ‏`docs/conventions/parallel-safe-code.md` §1, §2 — ‏additive vs invasive.
4. ‏`AGENTS.md` (root) §Worktrees, §Ports.

**reference בזמן עבודה**:

- ‏`packages/frontend/src/lib/engines/recorder.ts` — ‏דוגמה ל-engine ב-FE עם browser API.
- ‏`packages/frontend/src/lib/view-models/speaker.svelte.ts` — ‏ה-Speaker שמחזיק את ה-`Player` (commit 2 מוסיף `onPlaybackStart` callback ל-ctor של Player).
- ‏`packages/frontend/src/lib/engines/player.svelte.ts` — ‏ה-`#playLoop` (שורה ~70, `state="playing"`) — ‏נקודת ה-callback של commit 2.
- ‏`packages/frontend/src/lib/view-models/derived/voice-mode.svelte.ts` — ‏ה-FSM שממנו נגזרים מצבי ה-cue.

---

## §1 — מטרה

‏אחרי slice 6: ‏האישה לוחצת על Mic → ‏שומעת ping קצר (A5). ‏מסיימת לדבר → ping אחר (E5).
‏הסוכן חושב → ‏צליל עולה. ‏מתחיל לדבר → ‏צליל יורד. ‏שגיאה → ‏צליל יורד מאיים. ‏כל זה **‏אוטומטית**,
‏בלי שתסתכל על המסך — drive-first. ‏ה-cues מנוגנים על ידי ה-owner של כל transition (Mic / Speaker /
‏AgentSession), ‏לא על ידי מנגנון חיצוני שמנחש.

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|---|---|---|
| ‏CuesEngine (Web Audio oscillator) | ✅ | ‏commit 0 |
| ‏5 cues לפי spec | ✅ | ‏commit 0 |
| ‏Lazy AudioContext (user gesture) | ✅ | ‏commit 0 |
| ‏`enabled` toggle על engine | ✅ | ‏commit 0 |
| ‏Context + layout wiring (יצירת engine + הזרקה ל-VMs) | ✅ | ‏commit 1 |
| ‏Mic מנגן recordingStart/recordingStop | ✅ | ‏commit 2 |
| ‏Speaker מנגן speaking | ✅ | ‏commit 2 |
| ‏AgentSession מנגן thinking/error (effect פנימי) | ✅ | ‏commit 3 |
| ‏Volume control / per-cue mute | ❌ | ‏slice 9 (Settings) |
| ‏Custom cue sounds (uploaded files) | ❌ | ‏future |
| ‏Car-mode startup chime | ❌ | ‏slice 7 |

---

## §3 — Architecture

```
+layout.svelte  (composition root — המקום היחיד עם new X())
  │
  ├─ // ─── cues ─── (section חדש)
  │    const cues = new CuesEngine()          ← engine חדש (engines/cues.ts)
  │
  ├─ const session = new AgentSession({ cues })        ← cues? אופציונלי (commit 3)
  ├─ const speaker = new Speaker({ session, settings, cues })   ← (commit 2)
  ├─ const mic = new Mic({ session, cues })            ← (commit 2)
  └─ const voiceMode = new VoiceMode({ mic, session, speaker })  (ללא שינוי)

owner-driven cue mapping (חוק זהב #4 — side effect אצל owner של ה-state):
‏**כל cue דרך מתודה/callback מפורש — אפס $effect, אפס ניחוש מ-derived state.**

  Mic.toggle():   idle → recording         → cues?.play("recordingStart")  [קריאה ישירה]
  Mic.toggle():   recording → transcribing → cues?.play("recordingStop")   [קריאה ישירה]
  Player.#playLoop: idle → playing          → onPlaybackStart?()            [callback]
       └─ Speaker מעביר onPlaybackStart = () => cues?.play("speaking")
  AgentSession.#setStatus("thinking")       → cues?.play("thinking")        [setter מרכז]
  AgentSession.#setStatus("error")          → cues?.play("error")           [setter מרכז]

‏שכבות (frontend/AGENTS.md):
  engines/   ← CuesEngine (owner של AudioContext, imperative, browser-only)
  engines/   ← Player מקבל onPlaybackStart? callback (גנרי — לא יודע על cues)
  view-models/ ← Mic, Speaker, AgentSession מזריקים cues וקוראים play() מפורשות
```

**‏החלטה ארכיטקטונית (owner-driven, גישה B1, מתודות מפורשות)**: ‏ה-cues מנוגנים על ידי
‏ה-VM שמחזיק את ה-state שעובר transition — ‏לא על ידי "Cues VM" חיצוני שמנחש מתוך `$derived`,
‏**‏ולא דרך `$effect`**. ‏הסיבות:

1. **‏חוק זהב #4** — ‏side effect שייך ל-owner של ה-state. Mic יודע *‏בדיוק* ‏מתי הוא עובר
   ‏ל-recording; ‏אין צורך לנחש זאת מ-`VoiceMode.state` ה-derived.
2. **‏ההצדקה לגישה החיצונית נעלמה** — ‏ה-brief המקורי בחר מנגנון חיצוני כדי להישאר additive
   ‏בזמן ש-slice 3 רץ במקביל. ‏slice 3 כבר merged → ‏אין מקביליות → ‏אפשר לגעת ב-VMs.
3. **‏מתודה > effect** — ‏`$effect` הוא reactive-magic פחות מפורש ויציב (רץ כש-Svelte מחליט,
   ‏קשה ל-debug, סיכון לולאה). ‏מתודה/callback מפורש = ‏call site נראה, flow לינארי. ‏שלושת
   ‏ה-VMs שונים מבנית אבל כולם מקבלים פתרון מפורש:
   - ‏**Mic** — ‏transition אחד מקומי ב-`toggle()` → ‏קריאה ישירה.
   - ‏**Player/Speaker** — ‏המעבר ל-playing קורה בנקודה אחת (`#playLoop`, `state="playing"`).
     ‏Player מקבל `onPlaybackStart?` callback (גנרי, לא יודע על cues); ‏Speaker מספק אותו.
   - ‏**AgentSession** — ‏`status` משתנה ב-~6 מקומות מפוזרים. ‏הפתרון: **setter מרכז יחיד**
     ‏`#setStatus(next)` שכל ה-writes עוברים דרכו, ‏ומנגן cue ב-transition. ‏זה refactor
     ‏INVASIVE שמרדכי מאשר (slice 3 merged, אין מקביליות) — ‏ומנקה code smell קיים.

> **‏למה CuesEngine הוא engine ולא VM**: ‏הוא owner של resource (AudioContext) ללא `$state`
> ‏ריאקטיבי — ‏בדיוק כמו `Recorder` / `Player` / `AudioStream`. ‏זרימת import חוקית: VM → engine.
> ‏אם בעתיד תהיה לוגיקה טהורה הניתנת לשיתוף (טבלת frequencies) ‏אפשר להוריד ל-`core/` —
> ‏אבל פה הכל קשור Web Audio → client-only → engine.

‏קבצים חדשים:
- ‏`packages/frontend/src/lib/engines/cues.ts` — ‏ה-engine
- ‏`packages/frontend/src/lib/engines/cues.test.ts` — ‏tests structural

‏קבצים שמשתנים:

| ‏קובץ | ‏שינוי | ‏סוג |
|---|---|---|
| ‏`src/lib/context.ts` | ‏section חדש `// ─── cues ───` בסוף: `import type { CuesEngine }` + `export const [getCues, setCues] = createContext<CuesEngine>()` | Additive |
| ‏`src/routes/+layout.svelte` | ‏section חדש `// ─── cues ───`: `const cues = new CuesEngine()` + import. ‏הזרקת `cues` ל-3 ה-constructors הקיימים. `setCues(cues)`. | Additive (ראה commit 1 על ההזרקה) |
| ‏`src/lib/engines/player.svelte.ts` | ‏ctor מקבל `onPlaybackStart?: () => void`. ‏קריאה לו ב-`#playLoop` כש-`state="playing"` | Additive (param אופציונלי) |
| ‏`src/lib/view-models/mic.svelte.ts` | ‏ctor מקבל `cues?`. ‏שתי קריאות `cues?.play(...)` ב-`toggle()` | Additive (מתודה קיימת, dep אופציונלי) |
| ‏`src/lib/view-models/speaker.svelte.ts` | ‏ctor מקבל `cues?`. ‏מעביר `onPlaybackStart` ל-`new Player(...)` | Additive |
| ‏`src/lib/view-models/agent-session.svelte.ts` | ‏ctor מקבל `cues?`. ‏`#setStatus()` setter מרכז + ‏החלפת ~6 `this.status = X` writes בקריאות `#setStatus(X)` | **‏INVASIVE — מאושר ע"י מרדכי (ראה הערה)** |

> **‏הערת parallel-safe על AgentSession (INVASIVE מאושר)**: ‏הוספת `#setStatus()` דורשת **‏החלפת
> ‏שורות `this.status = X` קיימות** בקריאות `this.#setStatus(X)` — ‏זה **‏INVASIVE** (נוגע ב-state writes).
> ‏מרדכי (planner) **‏מאשר** את ה-refactor הזה: slice 3 merged → ‏אין worktrees מקבילים שייפגעו,
> ‏וזה מנקה code smell קיים (status מפוזר ב-6 מקומות ללא נקודת-mutation אחת). ‏ה-executor
> ‏**‏לא** מוסיף/מסיר שדות `$state` ולא משנה את ה-state machine עצמו — ‏רק מנתב את כל ה-writes
> ‏הקיימים דרך setter יחיד. ‏אם מתגלה צורך לשנות את ה-states עצמם או לוגיקת ה-FSM — ‏**‏עצור ושאל
> ‏את מרדכי** (parent task).

---

## §4 — Commits

### Commit 0 — CuesEngine + tests (approach: **TDD**)

‏לוגיקה טהורה ב-engine + tests structural — ‏TDD מתאים (shape ידוע מראש).

**קבצים חדשים**:
- ‏`packages/frontend/src/lib/engines/cues.ts`
- ‏`packages/frontend/src/lib/engines/cues.test.ts`

**API skeleton** (החתימה הציבורית — ‏ה-executor לא משנה אותה):

```ts
/**
 * CuesEngine — synthesises short audio cues via Web Audio API.
 *
 * 5 cue types per frontend-spec §10. AudioContext is created lazily on
 * the first play() call (browsers require user gesture before creation).
 * Once created, the context stays alive — subsequent plays reuse it.
 *
 * זה engine (engines/), לא VM: owner של AudioContext, ללא $state.
 */
export type CueId =
  | "recordingStart"
  | "recordingStop"
  | "thinking"
  | "speaking"
  | "error"

export class CuesEngine {
  enabled: boolean = true  // slice 9 יקשור ל-Settings (plain boolean מספיק כרגע)

  #ctx: AudioContext | null = null

  /**
   * Play a cue. No-op אם enabled=false או אם AudioContext לא יכול להיווצר
   * (SSR / browser blocked). אף פעם לא זורק.
   */
  play(cue: CueId): void

  /** Cleanup, נקרא ב-destroy של layout (אופציונלי). */
  close(): Promise<void>
}
```

**Implementation pattern** (פסאודו — ‏ה-executor ממש לפי זה):

```
play(cue):
  if (!enabled) return
  if (typeof AudioContext === "undefined") return  // SSR / no Web Audio
  if (!#ctx) {
    try { #ctx = new AudioContext() }
    catch { return }  // browser חסם
  }
  if (#ctx.state === "suspended") void #ctx.resume()
  switch (cue):
    case "recordingStart": playTone(880, 120)              // A5
    case "recordingStop":  playTone(660, 120)              // E5
    case "thinking":       playGlide(523, 659, 300)        // C5 → E5 (עולה)
    case "speaking":       playGlide(659, 523, 300)        // E5 → C5 (יורד)
    case "error":          playGlide(329, 220, 400)        // E4 → A3 (אזעקה יורדת)

playTone(freq, ms):
  const t = #ctx.currentTime
  const osc = #ctx.createOscillator()
  const gain = #ctx.createGain()
  osc.frequency.value = freq
  osc.type = "sine"
  gain.gain.setValueAtTime(0, t)
  gain.gain.linearRampToValueAtTime(0.2, t + 0.005)        // fast attack
  gain.gain.linearRampToValueAtTime(0, t + ms / 1000)      // decay
  osc.connect(gain).connect(#ctx.destination)
  osc.start(t)
  osc.stop(t + ms / 1000 + 0.05)

playGlide(fromFreq, toFreq, ms):
  // זהה ל-playTone, אבל:
  osc.frequency.setValueAtTime(fromFreq, t)
  osc.frequency.linearRampToValueAtTime(toFreq, t + ms / 1000)
```

**Tests** (structural — ‏בדיקת shape עם `vi.stubGlobal`, ‏לא שמע בפועל):

1. ‏`new CuesEngine()` יוצר instance עם `enabled === true` ו-`#ctx` עדיין null (לא נגיש ישירות — ‏בדוק עקיפות: ‏ראה test 5).
2. ‏`play("recordingStart")` עם AudioContext מ-mock — ‏לא זורק, ‏ו-`createOscillator` נקרא.
3. ‏`enabled = false` + `play(...)` = ‏no-op (ה-mock constructor של AudioContext **לא** נקרא).
4. ‏SSR safety: `vi.stubGlobal("AudioContext", undefined)` + `play(...)` = ‏no-op, ‏לא זורק.
5. ‏`play` ראשון יוצר AudioContext (constructor mock נקרא פעם 1), ‏`play` שני משתמש באותו (constructor לא נקרא שוב — ‏עדיין call count = 1).
6. ‏`play` עם `#ctx.state === "suspended"` קורא ל-`resume()`.
7. ‏`close()` קורא ל-`#ctx.close()` אם קיים; ‏no-op אם null.

**‏הערת mock**: ‏ה-vitest של FE רץ ב-environment node. ‏צור mock class ל-`AudioContext` עם
‏`createOscillator`/`createGain`/`destination`/`state`/`resume`/`close` כ-`vi.fn()`,
‏והזרק עם `vi.stubGlobal("AudioContext", MockAudioContext)`. ‏ה-glob ב-`vitest.config.ts`
‏(`**/*.{test,spec}.{ts,svelte.ts}`) ‏תופס את `cues.test.ts` אוטומטית.

**Verification**:

```bash
pnpm --filter @drive-coding/frontend-v2 test
pnpm --filter @drive-coding/frontend-v2 typecheck
```

---

### Commit 1 — Context + layout wiring (approach: **manual**)

‏מוסיף את ה-CuesEngine ל-app singletons **‏ומזריק** אותו ל-3 ה-VMs.

**קבצים שמשתנים**:

| ‏קובץ | ‏שינוי |
|---|---|
| ‏`src/lib/context.ts` | ‏section חדש בסוף: `// ─── cues ───` + `import type { CuesEngine } from "./engines/cues"` (לבלוק ה-import) + `export const [getCues, setCues] = createContext<CuesEngine>()` |
| ‏`src/routes/+layout.svelte` | (1) `import { CuesEngine } from "$lib/view-models/..."` → ‏**לא**: `import { CuesEngine } from "$lib/engines/cues"`. (2) `setCues` ל-import מ-`$lib/context`. (3) section `// ─── cues ───`: `const cues = new CuesEngine()` — **‏לפני** session/speaker/mic (תלות). (4) ‏הזרק `cues` ל-3 ה-ctors. (5) `setCues(cues)` בבלוק החיווט. |

> **‏סדר ההכרזה ב-layout**: ‏`cues` חייב להיות מוכרז **‏לפני** `session`, `speaker`, `mic`
> ‏(הם מקבלים אותו כ-dep). ‏ה-section header `// ─── cues ───` ימוקם מעל `// ─── סשן ───`.

**‏הזרקה ל-ctors הקיימים** (ה-VMs עדיין לא קוראים `play` — ‏זה commit 2/3; ‏כאן רק מעבירים את ה-dep):

```svelte
const cues = new CuesEngine()
const session = new AgentSession({ cues })            // ctor יקבל cues? ב-commit 3
const speaker = new Speaker({ session, settings, cues })  // commit 2
const mic = new Mic({ session, cues })                // commit 2
```

> **‏סדר commits**: ‏commit 1 מעביר את ה-dep אבל ה-ctors עדיין לא משתמשים בו. ‏זה תקין כל עוד
> ‏ה-param אופציונלי (`cues?`). ‏ה-executor יכול **‏לחלופין** לאחד commit 1+2+3 אם נוח לו —
> ‏אבל כל commit חייב לעבור typecheck+build ירוקים. ‏אם מפצל: ‏ב-commit 1 ה-ctors כבר מקבלים
> ‏`cues?` בחתימה (גם אם לא משתמשים) כדי שה-layout יעבור typecheck.

**Verification**:

```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm --filter @drive-coding/frontend-v2 build
pnpm lint:i18n
```

---

### Commit 2 — Mic cue + Player callback (approach: **manual**)

**`mic.svelte.ts`** (transition אחד מקומי → ‏קריאה ישירה):
- ‏ctor: `constructor(opts: { session: AgentSession; cues?: CuesEngine })` → ‏שמור `this.#cues = opts.cues`.
- ‏ב-`toggle()`, ‏מצב `idle → recording`: **‏אחרי** ש-`recorder.start()` הצליח (לפני ה-`return`),
  ‏הוסף `this.#cues?.play("recordingStart")`. ‏**‏לא** לפני start (אם ההרשאה נדחית — ‏אין cue).
- ‏ב-`toggle()`, ‏מצב `recording → transcribing`: ‏מיד אחרי `this.state = "transcribing"`,
  ‏הוסף `this.#cues?.play("recordingStop")`.
- ‏ב-`cancel()`: ‏**‏אין** cue (ביטול ≠ ‏זרימה רגילה).

**`player.svelte.ts`** (engine — ‏מקבל callback גנרי, ‏לא יודע על cues):
- ‏ctor: `constructor(audioStream: AudioStream, onPlaybackStart?: () => void)` → ‏שמור
  ‏`this.#onPlaybackStart = onPlaybackStart`.
- ‏ב-`#playLoop()`, ‏**‏מיד אחרי** `this.state = "playing"` (השורה הקיימת בתחילת הלולאה),
  ‏הוסף `this.#onPlaybackStart?.()`. ‏זה הנקודה היחידה שבה Player עובר idle→playing בזרימה רגילה.

> **‏למה callback ולא effect**: ‏ה-Player יודע *‏בדיוק* ‏מתי הוא מתחיל לנגן (שורה אחת ב-`#playLoop`).
> ‏אין צורך ש-Speaker ינחש זאת דרך `$effect` על `#player.state` עם prev-tracking עדין. ‏ה-Player
> ‏נשאר נקי מ-cues concept — ‏הוא רק קורא callback גנרי. ‏ה-Speaker הוא זה שיודע על cues.

**`speaker.svelte.ts`** (מספק את ה-callback + ‏guard fired-once-per-turn):
- ‏ctor: ‏הוסף `cues?: CuesEngine` ל-`opts`. ‏שמור `this.#cues = opts.cues`.
- ‏הוסף שדה רגיל (לא `$state`): `#spokeThisTurn = false`.
- ‏בבנאי, ‏שורת `this.#player = new Player(this.#audioStream)` הקיימת → ‏הפוך ל:
  ```ts
  this.#player = new Player(this.#audioStream, () => {
    if (this.#spokeThisTurn) return       // כבר ניגן cue בתור הזה
    this.#spokeThisTurn = true
    this.#cues?.play("speaking")
  })
  ```
- ‏**‏RESET — בתחילת תור, לא בסופו**: ‏ב-`#handleStatusTransition(status, enabled)` הקיים
  ‏(שמקבל `status` ויש לו גישה ל-`this.#prevStatus`), ‏הוסף בתחילת המתודה:
  ```ts
  // slice 6: תור דיבור חדש מתחיל כש-status עובר ל-thinking → אפס את ה-cue guard.
  if (status === "thinking" && this.#prevStatus !== "thinking") {
    this.#spokeThisTurn = false
  }
  ```
  ‏(המתודה רצה בתוך ה-`untrack` של ה-effect הקיים — ‏כתיבה לשדה רגיל, ‏בטוח. `#prevStatus`
  ‏כבר מתוחזק שם, ‏שורה 149.)
- ‏ב-`#stopAndClear()`: ‏הוסף `this.#spokeThisTurn = false` בתחילת המתודה — ‏**‏reset משני**
  ‏ל-cancel/toggle-off (לא מזיק, ‏מבטיח שגם ביטול מאפס).
- ‏**‏אין** `$effect` חדש, ‏**‏אין** `#prevPlayerState`. ‏ה-callback + ‏ה-2 reset points מטפלים בהכל.

> **⚠️ קריטי — ‏fired-once-per-turn (ממצא אביגיל #1, סבב 2)**: ‏שני שלבים לבאג, ‏שני תיקונים:
> ‏(1) ‏ה-`#playing` guard ב-Player מונע רק הרצה **‏מקבילה** של `#playLoop`, ‏**‏לא** re-entry
> ‏**‏סדרתי**. ‏עם `LOOKAHEAD=2` ו-fetch אסינכרוני התור מתרוקן בין משפטים → ‏המעבר idle→playing
> ‏חוזר → ‏בלי guard ה-cue יחזור באמצע הדיבור. ‏לכן `#spokeThisTurn`.
> ‏(2) ‏**‏ה-reset של הדגל חייב לקרות בתחילת תור (`→ thinking`), לא בסופו.** ‏`#stopAndClear`
> ‏**‏לא** רץ בסוף תור רגיל (`thinking→connected` ב-sendPrompt לא קורא לו — ‏רק toggle-off/cancel/destroy).
> ‏אילו הסתמכנו על `#stopAndClear` — ‏הדגל היה נשאר `true` אחרי תור A → ‏ה-cue היה נבלע
> ‏מתור B ואילך (באג הפוך). ‏לכן reset על מעבר ל-thinking = ‏נקודת התחלת-תור הוודאית.

> **‏החלטת מרדכי**: ‏"תור דיבור" = ‏מרגע `status → thinking` עד ה-thinking הבא. ‏ה-`speaking`
> ‏cue מסמן "הסוכן התחיל לדבר" — ‏פעם אחת בתחילת רצף ה-TTS, ‏לא לכל משפט. ‏reset-on-turn-start
> ‏(נקודה אחת ברורה) ‏עדיף על reset-on-turn-end (תלוי בזיהוי כל מסלולי הסיום כולל error).

**Verification**:

```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm --filter @drive-coding/frontend-v2 build
pnpm --filter @drive-coding/frontend-v2 test    # ודא שטסטים קיימים של mic/speaker לא נשברו
```

‏בדיקה ידנית (browser): ‏לחץ Mic → ‏שמע recordingStart. ‏דבר ועצור → recordingStop.
‏כשהסוכן מתחיל לדבר (TTS) → speaking.

---

### Commit 3 — AgentSession `#setStatus` setter + thinking/error cues (approach: **manual**)

> **‏זה ה-commit ה-INVASIVE.** ‏refactor של state writes מפוזרים לנקודת-mutation אחת.
> ‏מאושר ע"י מרדכי (ראה §3 הערת parallel-safe). ‏אם ה-executor מהסס — ‏§7.

**`agent-session.svelte.ts`** — ‏שני חלקים:

**(א) ‏הוסף ctor + setter מרכז**. ‏ל-AgentSession **‏אין כרגע ctor מפורש** (שדות `$state` +
‏מתודות arrow). ‏הוסף:

```ts
readonly #cues?: CuesEngine

constructor(opts?: { cues?: CuesEngine }) {
  this.#cues = opts?.cues
}

/**
 * נקודת-mutation יחידה ל-status. כל שינוי status עובר דרך כאן.
 * מנגן audio cue ב-transitions רלוונטיים (slice 6). אין $effect — קריאה מפורשת.
 */
#setStatus(next: AgentSessionStatus): void {
  const prev = this.status
  if (next === prev) return
  this.status = next
  if (next === "thinking") this.#cues?.play("thinking")
  else if (next === "error") this.#cues?.play("error")
}
```

> **‏שים לב — `opts?` אופציונלי**: ‏טסטים קיימים יוצרים `new AgentSession()` בלי args.
> ‏ה-ctor חייב לעבוד בלי opts (ולכן `opts?` + `opts?.cues`).

**(ב) ‏החלף את כל 12 ה-`this.status = X` writes ב-`this.#setStatus(X)`**. ‏המיקומים המדויקים
‏(נכון ל-tip `56139d7`; ‏slice 22/23 לא נגעו באזורי ה-writes — ‏אמת עם `grep` לפני העריכה):

| ‏שורה | ‏לפני | ‏אחרי |
|---|---|---|
| 94 | `this.status = "connecting"` | `this.#setStatus("connecting")` |
| 115 | `this.status = "error"` | `this.#setStatus("error")` |
| 132 | `this.status = "connected"` | `this.#setStatus("connected")` |
| 136 | `this.status = "error"` | `this.#setStatus("error")` |
| 144 | `this.status = "idle"` | `this.#setStatus("idle")` |
| 173 | `this.status = "thinking"` | `this.#setStatus("thinking")` |
| 177 | `if (this.status === "thinking") this.status = "connected"` | `if (this.status === "thinking") this.#setStatus("connected")` (ה-**‏קריאה** נשארת `this.status`, רק ה-**‏כתיבה** עוברת ל-setter) |
| 180 | `this.status = "error"` | `this.#setStatus("error")` |
| 199 | `this.status = "connecting"` | `this.#setStatus("connecting")` |
| 217 | `this.status = "error"` | `this.#setStatus("error")` |
| 239 | `this.status = "connected"` | `this.#setStatus("connected")` |
| 243 | `this.status = "error"` | `this.#setStatus("error")` |

> **⚠️ קריאות מ-status נשארות `this.status`** — ‏רק **‏כתיבות** (`this.status = X`) עוברות ל-`#setStatus(X)`.
> ‏בדיקות (`if (this.status === ... )` / `!==`) ‏**‏לא משתנות** בשום מקום. ‏הדרך הבטוחה לאתר את 12 ה-writes:
> ‏`grep -n "this\.status = " agent-session.svelte.ts` — ‏זה נותן בדיוק 12 שורות (כולל שורה 177
> ‏שבה ה-`this.status === "thinking"` הוא read שנשאר, ‏ורק ה-`this.status = "connected"` שאחריו הוא write).

> **‏למה setter ולא $effect**: ‏מתודה = ‏מפורש, ‏call site נראה, ‏flow לינארי, ‏בלי reactive-magic.
> ‏ה-setter גם **‏מנקה code smell קיים** (12 writes מפוזרים → ‏נקודה אחת). ‏זה הפטרן הסטנדרטי
> ‏ל-state machine. ‏אין סיכון לולאת-$effect (אין effect בכלל).

> **‏אין `destroy()` נדרש** — ‏אין effect לנקות. ‏(הסרנו את ה-`$effect.root` שהיה בגרסה קודמת.)

**Verification**:

```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm --filter @drive-coding/frontend-v2 build
pnpm --filter @drive-coding/frontend-v2 test    # טסטים קיימים של agent-session
pnpm lint:i18n
node tests/smoke/run-all.mjs                     # אם קיים — ודא smoke ירוק
```

‏בדיקה ידנית: ‏שלח פרומפט → ‏שמע thinking בתחילת החשיבה. ‏נתק WS באמצע / ‏גרום שגיאה → ‏שמע error.

---

### Commit 4 — walkthrough + docs (approach: **manual**)

**קבצים שמשתנים**:
- ‏`docs/walkthrough.md` — ‏entry על slice 6 (engine + owner-driven integration מלא).
- ‏`packages/frontend/docs/slices.md` — ‏status של slice 6: `💭` → `✅`.
- ‏`docs/plans/slice-6-audio-cues.md` (זה) — ‏סטטוס → "הושלם".

---

## §5 — DoD

| # | ‏בדיקה | ‏איך |
|---|---|---|
| 1 | ‏`new CuesEngine()` לא יוצר AudioContext עד `play()` ראשון | ‏Test (constructor mock call count) |
| 2 | ‏`play("recordingStart")` יוצר AudioContext + ‏קורא createOscillator | ‏Test |
| 3 | ‏`enabled = false` → `play()` no-op | ‏Test |
| 4 | ‏SSR safety: `AudioContext === undefined` → `play` לא זורק | ‏Test (stubGlobal) |
| 5 | ‏`play` שני משתמש באותו AudioContext | ‏Test (call count = 1) |
| 6 | ‏Mic: ‏לחיצה → recordingStart, ‏עצירה → recordingStop | ‏ידני (browser, אוזניים) |
| 7 | ‏Speaker: ‏תחילת TTS → speaking | ‏ידני (browser) |
| 8 | ‏AgentSession: ‏שליחת פרומפט → thinking, ‏שגיאה → error | ‏ידני (browser) |
| 9 | ‏ביטול (cancel) **‏לא** מנגן cue | ‏ידני |
| 10 | ‏typecheck + build + tests ירוקים | ‏ראה §4 |
| 11 | ‏i18n lint נקי | `pnpm lint:i18n` |
| 12 | ‏כל ה-test suite הקיים לא נשבר (אין טסטים ייעודיים ל-mic/speaker/agent-session — ‏רק core-level; ה-`grep` של 12 ה-writes ב-commit 3 הוא רשת הביטחון) | ‏`pnpm --filter @drive-coding/frontend-v2 test` |
| 13 | ‏smoke tests קיימים לא נשברו | ‏`tests/smoke/run-all.mjs` (אם קיים) |

---

## §6 — Risks + mitigations

| # | ‏סיכון | ‏מקור | ‏מיטיגציה |
|---|---|---|---|
| 1 | ‏AudioContext autoplay policy | ‏Chrome >= 71 | ‏lazy creation ב-`play()` הראשון. ‏הקריאה הראשונה (recordingStart) ‏תמיד אחרי click. |
| 2 | ‏SSR crashes | ‏`AudioContext` לא קיים ב-Node | ‏`typeof AudioContext === "undefined"` guard ב-play. |
| 3 | ‏Svelte 5: ‏$effect שכותב state שהוא קורא = ‏לולאה | ‏gotcha 2026-05-16 | ‏**‏ה-slice לא מוסיף שום `$effect`** (החלטה: מתודות/callback מפורש). ‏הסיכון הזה לא רלוונטי. ‏ה-setter `#setStatus` כותב `this.status` (כן $state) אבל מתוך **‏מתודה רגילה** (לא effect) → ‏אין re-trigger reactive. |
| 4 | ‏הזרקת `cues` שוברת טסטים קיימים של VMs | ‏general | ‏כל `cues?` אופציונלי. `new Mic({ session })` / `new AgentSession()` / `new Player(audioStream)` עדיין תקפים. |
| 5 | ‏`speaking` cue חוזר באמצע הדיבור / ‏נבלע מתור 2 | ‏ממצא אביגיל #1 (סבב 1+2) — ‏(א) `#playLoop` עושה re-entry סדרתי בין משפטים; ‏(ב) `#stopAndClear` לא רץ בסוף תור רגיל | ‏**‏שני** תיקונים: `#spokeThisTurn` guard ב-callback (מונע re-entry), ‏**‏ו-reset על מעבר `→ thinking`** ב-`#handleStatusTransition` (לא ב-`#stopAndClear`!). ‏ראה commit 2. ‏זו הנקודה שהפילה את סבב 2 — ‏reset במקום הלא נכון הפך את הבאג. |
| 6 | ‏Hardcoded Hebrew בקוד | ‏pre-commit hook | ‏ה-slice לא מוסיף UI strings (cue IDs באנגלית). ‏אין `t(key)` נדרש. ‏הערות עברית בקוד **‏מותרות** (lint מסנן הערות). |
| 7 | ‏webkit ישן (iOS Safari < 14) | ‏prefixed `webkitAudioContext` | ‏MVP: ‏לא תומכים. ‏fallback אופציונלי: `(window.AudioContext ?? (window as any).webkitAudioContext)`. ‏לא חוסם. |
| 8 | ‏ה-refactor של `#setStatus` שובר transition לוגי קיים | ‏INVASIVE | ‏ה-setter שקול לוגית ל-`this.status = X` + ‏מנגן cue. ‏החלפה מכנית 1:1 (טבלת commit 3). ‏בדיקת regression: ‏טסטים קיימים של agent-session + ‏manual flow מלא (connect→prompt→error). ‏אם transition משתנה התנהגותית — ‏§7. |
| 9 | ‏ה-`error` cue מנגן יותר מדי (כל מעבר ל-error) | ‏UX | ‏`#setStatus` מנגן רק על **‏transition** (`next !== prev`) → ‏לא חוזר על error שכבר פעיל. ‏מקובל. |

> **‏הערה על OneCLI**: ‏ה-slice הזה **‏לא** נוגע ב-SDK חיצוני (Web Audio בלבד). ‏פטרן ה-placeholder
> ‏apiKey לא רלוונטי כאן.

---

## §7 — Escalation triggers

‏עצור ושאל את מרדכי (parent task) אם:

1. ‏הוספת `onPlaybackStart` callback ל-Player דורשת שינוי מבני ב-`#playLoop` (יותר מהוספת קריאה אחת אחרי `state="playing"`) — ‏אולי ה-state machine של Player שונה ממה שהונח.
2. ‏ה-refactor של `#setStatus` ב-AgentSession מגלה transition שלא מתמפה נקי (status נכתב במקום שלא ב-12 השורות, ‏או לוגיקה תלוית-סדר) — ‏עצור.
3. ‏צריך לשנות **‏שדה `$state` קיים** או את **‏ה-states עצמם / לוגיקת ה-FSM** ב-AgentSession (מעבר להחלפה המכנית של ה-writes ל-setter).
4. ‏ה-AudioContext mock ב-vitest מסובך מדי (>20 דקות לעבוד) — ‏אולי לפשט ל-smoke בלבד.

‏אחרת: ‏החלט סבירות, ‏רשום ב-commit message, ‏המשך.

---

## §8 — Complexity score: 4/10

| ‏פקטור | ‏ניקוד |
|---|---|
| ‏מספר commits (4) | ‏נמוך-בינוני |
| ‏שכבות חדשות (engine בלבד) | +1 |
| ‏APIs חיצוניים | 0 |
| ‏Browser APIs (Web Audio) | +1 |
| ‏Streaming pipeline | 0 |
| ‏Refactor של state (`#setStatus` ב-AgentSession — INVASIVE אך מכני) | +1 |
| ‏שינוי protocol BE↔FE | 0 |
| ‏Integration עם 3 VMs + ‏Player (owner-driven, מתודות מפורשות) | +2 |
| ‏סה"כ | **4-5** |

**Verifier**: `calev` (Sonnet, mode: light). ‏אין phase verifier — ‏ה-slice קטן, ‏אבל
‏ה-integration נוגע ב-3 VMs → ‏light end-of-slice חובה (במיוחד בדיקה שמיעתית ידנית של 5 ה-cues +
‏אישוש שאין רגרסיה בטסטים קיימים).

---

## §9 — שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|---|---|---|
| 1 | ‏גלים rising/falling — ‏linear או exponential ramp? | ‏linear (פשוט). ‏tweaking ב-follow-up אם מכני | ❌ |
| 2 | ‏Sine או square/triangle? | ‏Sine (טוב ל-cues קצרים) | ❌ |
| 3 | ‏Volume — ‏0.2 gain | ‏לא בוטה. ‏slice 9 יוסיף slider | ❌ |
| 4 | ‏Webkit prefix ל-iOS ישן | ‏לא תומכים ב-MVP | ❌ |
| 5 | ‏האם `error` cue צריך לנגן גם על שגיאת mic (permission denied)? | ‏לא — ‏רק על `session.status === "error"`. ‏permission denied מציג טקסט, ‏לא צליל מאיים | ❌ |

---

## §10 — מה אחרי slice 6

- ‏slice 9 (Settings) — ‏toggle לכל cue + ‏volume slider + ‏קישור `CuesEngine.enabled` ל-Settings.
- ‏slice 7 (car mode) — ‏startup chime שונה (A5 → E6).
- ‏Custom cue sounds (uploaded WAV) — ‏future.
