# Slice tab-attention-notify — סימן "דורש תשומת לב" בטאב כשה-turn מסתיים והדף מוסתר — תוכנית

> **תאריך**: 2026-07-03
> **סטטוס**: ✅ מאושר (אביגיל r1 READY, 3×🟢 — 2026-07-03) · ready ל-dispatch (אחרי B)
> **Complexity**: 4/10 (verifier: light)
> **תלות (depends_on)**: `[app-title-build-env]` — **שניהם נוגעים ב-`document.title`** (הסלייס הזה מוסיף prefix ל-`docTitle` שנוצר שם). **Base**: branch של `slice/app-title-build-env` (שרשור) אם טרם מוזג, אחרת `dev` אחרי מיזוגו.

---

## §0 — Pre-flight

### רקע — גרסה קלה במכוון
המשתמשת ביקשה (28/06 → 03/07): "סימן של דורש תשומת לב כשמסיים והמשתמש עדיין לא עבר לטאב. **אם זה מסובך אז לא עכשיו**." → הגרסה כאן היא ה**קלה**: prefix `● ` בכותרת-הטאב כשה-turn מסתיים בזמן ש-`document.hidden`, וניקוי כשחוזרים לטאב. **בלי** OS-Notification (זה ה"מסובך" — הרשאות, permission prompt, שונות בין דפדפנים).

### עובדות שאומתו (חוסך חיפוש)
- `session.turnState` — **`$state<TurnState>` ציבורי** (`agent-session.svelte.ts:119`). ריאקטיבי, נגיש דרך `getSession()`.
- **דפוס "turn הסתיים"**: `#prevTurnState !== "idle" && turnState === "idle"` — כבר בשימוש ב-`speaker.svelte.ts:304` (העתק את הלוגיקה, לא את הקוד).
- **דפוס `visibilitychange` נקי**: `lib/engines/wake-lock.ts` (addEventListener ב-constructor, removeEventListener ב-dispose, בדיקת `document.visibilityState`). זה ה-reference לשכבת-engine.
- **הכותרת נוצרת ב-`+layout.svelte`** ע"י slice `app-title-build-env` כ-`docTitle` ($derived) בתוך `<svelte:head><title>`. הסלייס הזה **מקדים** ל-`docTitle` את ה-prefix.
- favicon: קיים רק `static/icons/favicon-64.png` (החלפת-favicon = asset חדש → מחוץ ל-scope, §9).

### Worktree
```bash
# base = branch של app-title (שרשור) אם טרם מוזג:
git worktree add .worktrees/tab-attention-notify -b slice/tab-attention-notify slice/app-title-build-env
# (אם app-title כבר מוזג ל-dev: gזור מ-dev במקום)
cd .worktrees/tab-attention-notify
pnpm install && pnpm hooks:install
```

### Run
- BE: `cd packages/backend && onecli run --agent voice-acp -- bun --watch src/server.ts` (4000)
- FE: `pnpm --filter @drive-coding/frontend dev`

### Browser
- Chrome. שלח פרומפט ארוך → **עבור לטאב אחר** לפני שהמודל מסיים → כשמסתיים, כותרת-הטאב (ברקע) מקבלת `● ` בהתחלה. חזור לטאב → ה-`● ` נעלם.

### Reading list
**must-read**:
- `packages/frontend/src/lib/engines/wake-lock.ts` (כל הקובץ — דפוס engine עם visibilitychange listener + dispose).
- `packages/frontend/src/lib/view-models/speaker.svelte.ts:295-305` (דפוס גילוי non-idle→idle).
- `packages/frontend/src/routes/+layout.svelte` — איפה `docTitle`/`<svelte:head>` (נוצר ב-app-title); + דפוס רישום engine (`WakeLockEngine`, `:118-123` — construct + `$effect` dispose).

**reference**:
- `docs/plans/slice-app-title-build-env.md` §Commit 3 (מבנה ה-`docTitle`).

---

## §1 — מטרה

אחרי הסלייס: כשהמודל מסיים לענות ואתה לא בטאב (`document.hidden`), כותרת-הטאב ברקע מקבלת סימן `● ` בהתחלה — כך שבמבט על שורת-הטאבים אתה רואה שיש תשובה שמחכה. ברגע שאתה חוזר לטאב, הסימן נעלם.

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| engine `AttentionEngine` — flag `needsAttention` + visibilitychange listener | ✅ | Commit 1 |
| prefix `● ` ב-`docTitle` (ב-+layout, לפני base) | ✅ | Commit 2 |
| חיווט: `$effect` על `session.turnState` → `attention.notifyTurn(...)` | ✅ | Commit 2 |
| OS-Notification (Notification API + permission) | ❌ | "המסובך" — המשתמשת ביקשה לדחות. slice עתידי אם ירצו |
| החלפת favicon לאייקון-התראה | ❌ | דורש asset חדש (יש רק favicon-64). §9 — אם ירצו, +icon |
| ספירת הודעות-ממתינות / כמה turns | ❌ | future — סימן בינארי בלבד |
| צליל/רטט | ❌ | יש כבר `cues` (audio) לזה בנפרד; לא כאן |

## §3 — Architecture diagram

```
engine (browser glue)                       component (composition root)
AttentionEngine                             +layout.svelte
  needsAttention = $state(false)            const attention = new AttentionEngine()
  #prevTurn: TurnState = "idle"             $effect(() => attention.notifyTurn(session.turnState))  ← track turnState
  notifyTurn(ts): if #prev!=="idle"         $effect(() => () => attention.dispose())
    && ts==="idle" && document.hidden
    → needsAttention = true; #prev = ts     // app-title docTitle:
  (ctor) visibilitychange →                 const docTitle = $derived(
    visible ⇒ needsAttention = false          (attention.needsAttention ? "● " : "") +   ← חדש (prefix)
  dispose() removeEventListener               (titleContext ? `${base} • ${titleContext}` : base)
                                            )
```
> שכבה: **engine** (browser-API glue — visibilitychange, כמו wake-lock) + חיווט ב-composition-root. **לא TDD** על ה-listener (browser API), אבל `notifyTurn` הוא לוגיקה כמעט-טהורה → אפשר bunit-test עם `document.hidden` ממוקמט (ר' §4 Commit 1).

## §4 — Commits

### Commit 1 — AttentionEngine (approach: mixed — unit על notifyTurn, manual על listener)

**קובץ חדש**: `packages/frontend/src/lib/engines/attention.ts`
```ts
import type { TurnState } from "..."  // אותו type כמו ב-agent-session (מצא את מקורו)

/** מסמן "דורש תשומת לב" כשה-turn מסתיים בזמן שהדף מוסתר; מתנקה בחזרה לטאב. */
export class AttentionEngine {
  needsAttention = $state(false)
  #prevTurn: TurnState = "idle"
  #bound = () => {
    // כשחוזרים לטאב (visible) — נקה את הסימן.
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      this.needsAttention = false
    }
  }
  constructor() {
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.#bound)
    }
  }
  /** נקרא מ-$effect ב-layout עם turnState הנוכחי. non-idle→idle בזמן hidden = הדלק. */
  notifyTurn(ts: TurnState): void {
    if (this.#prevTurn !== "idle" && ts === "idle") {
      if (typeof document !== "undefined" && document.hidden) this.needsAttention = true
    }
    this.#prevTurn = ts
  }
  dispose(): void {
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.#bound)
    }
  }
}
```
> `attention.ts` הוא `.ts` רגיל (לא `.svelte.ts`) — אבל משתמש ב-`$state`. **בדוק**: אם `$state` דורש `.svelte.ts` (runes רק בקבצי-svelte) → שנה את השם ל-`attention.svelte.ts` (כמו `player.svelte.ts`, `recent-projects.svelte.ts` בפרויקט). ברירת-מחדל: **`attention.svelte.ts`** (בטוח).

**קובץ חדש (test)**: `packages/frontend/src/lib/engines/attention.svelte.test.ts` — טסטים ל-`notifyTurn`:
- non-idle→idle כש-`document.hidden=true` → `needsAttention===true`.
- non-idle→idle כש-`hidden=false` → נשאר `false`.
- idle→idle → `false` (אין turn).
- (mock: `Object.defineProperty(document, "hidden", { configurable:true, get:() => …})`).

**Verification**:
```bash
pnpm --filter @drive-coding/frontend test attention   # הטסטים ירוקים
pnpm --filter @drive-coding/frontend typecheck
```

### Commit 2 — חיווט ב-+layout + prefix בכותרת (approach: manual)

**קבצים שמשתנים**:
- `packages/frontend/src/routes/+layout.svelte`:
  1. `import { AttentionEngine } from "$lib/engines/attention.svelte"` + `const attention = new AttentionEngine()` (באזור ה-engines, ליד `wakeLock`).
  2. חיווט + dispose:
```svelte
$effect(() => attention.notifyTurn(session.turnState))   // track turnState → engine
$effect(() => () => attention.dispose())
```
  3. הקדמת prefix ל-`docTitle` (שנוצר ב-app-title):
```svelte
// לפני (app-title):  titleContext ? `${baseTitle} • ${titleContext}` : baseTitle
// אחרי:
const docTitle = $derived(
  (attention.needsAttention ? "● " : "") +
    (titleContext ? `${baseTitle} • ${titleContext}` : baseTitle)
)
```

**Verification**:
```bash
pnpm --filter @drive-coding/frontend typecheck
# smoke (ר' §0 Browser): פרומפט ארוך → עבור טאב → סיום → "● Drive Coding …" בטאב הרקע → חזור → נעלם
```

## §5 — DoD

| בדיקה | איך |
|---|---|
| turn מסתיים כשהדף מוסתר → כותרת-הטאב מתחילה ב-`● ` | smoke: פרומפט ארוך + מעבר-טאב |
| חזרה לטאב → ה-`● ` נעלם מיד | smoke: visibilitychange |
| turn מסתיים כשהדף **גלוי** → אין `● ` (לא מטריד כשאתה שם) | smoke: השאר בטאב |
| ה-prefix מתלבש נכון על ה-docTitle של app-title (`● Drive Coding Dev • …`) | code review + smoke |
| `notifyTurn` unit-tests ירוקים (3 מקרים) | `pnpm test attention` |
| dispose מסיר listener (אין דליפה ב-HMR/unmount) | code review (mirror wake-lock) |
| typecheck 0 · `lint:i18n` נקי (אין מחרוזת עברית; `●` הוא תו) | הפקודות |

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|---|---|---|
| `$state` בקובץ `.ts` רגיל לא-מהודר | Svelte 5 runes רק ב-`.svelte`/`.svelte.ts` | שם הקובץ `attention.svelte.ts` (כמו player/recent-projects הקיימים) |
| `document.hidden` ב-SSR/prerender (adapter-static) → crash | טבע adapter-static | guard `typeof document !== "undefined"` בכל גישה (כמו ב-wake-lock) |
| `$effect` על `session.turnState` לא נורה כי turnState לא ריאקטיבי | — | אומת: `turnState = $state<TurnState>` (`agent-session:119`) — ריאקטיבי ✓ |
| double-fire / flicker אם turnState עושה idle→responding→idle | msr-v2 note (`agent-session:199`) | ה-flag בינארי + מתנקה רק ב-visible; ריצוד בכותרת-רקע לא-מורגש. לא-חוסם |
| התנגשות עם app-title על `docTitle` | depends_on | הסלייס **מבוסס על branch של app-title** (שרשור) — עורך את אותו `$derived` שכבר קיים שם |

## §7 — Escalation triggers

- `$state` לא עובד גם ב-`.svelte.ts` → בעיית-tooling עמוקה, שאל.
- `app-title-build-env` **לא** מוזג/לא זמין כ-base → אין `docTitle` להקדים לו prefix. **אל תיצור** מנגנון-כותרת מקביל — תאם עם מרדכי (השרשור).
- turnState לא עובר ל-idle בסיום (נתקע responding) → זה באג ב-turn-tracker, לא בסלייס הזה — דווח (קשור ל-watchdog ב-roadmap).

## §8 — Complexity score

- commits: 2 · שכבה חדשה: 1 (engine) · APIs חיצוניים: 0 (רק visibilitychange) · async: לא · state refactor: לא · protocol: לא.
- +1 ערנות: תלות-שרשור ב-app-title (עריכת אותו `docTitle`).

**Score ≈ 4/10 → verifier `calev` mode: light.**

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | סימן `● ` או תו אחר (🔴 / ⬤ / •)? | `● ` (U+25CF + רווח) — בולט, ניטרלי, אין תלות-emoji-פונט. | ❌ |
| 2 | גם החלפת favicon (בולט יותר בשורת-טאבים צפופה)? | לא — דורש asset חדש (`favicon-attention-64.png`). אם ירצו: +icon + החלפת `<link rel=icon>` href. | ❌ |
| 3 | להדליק גם על turn שמסתיים **בשגיאה** (לא רק הצלחה)? | כן — `turnState → idle` תופס את שני המקרים (המשתמש רוצה לדעת שהסתיים, גם אם נכשל). | ❌ |
| 4 | האם depends_on מחייב מיזוג app-title קודם, או שרשור? | שרשור (base=branch של app-title). מרדכי ממזג app-title→dev ואז tab-attention→dev בסדר. | ❌ |
