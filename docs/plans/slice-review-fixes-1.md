# Slice review-fixes-1 — `withTimeout` helper + F3 (transcribe) + F1 (settings "נשמר") — תוכנית

> **תאריך**: 2026-06-02
> **סטטוס**: הושלם (אליעזר, 2026-06-02 — 4 commits: ecc6152→568bb6a→67694fb→2a551d4)
> **Complexity**: 4/10 (verifier: light)
> **תלויות (`depends_on`)**: [] — בנוי ישירות על dev
> **Base**: dev
> **Dev tip**: `bd691ea`

---

## §0 — Pre-flight

### תלויות (חובה!)

slice זה **אין לו תלויות** — בנוי ישירות על dev `bd691ea`.
הקבצים שמשתנים (core/async, transcribe.ts, translate.ts, settings/+page.svelte) לא
משתנים ע"י אף slice פתוח אחר (6/24/25/26 נוגעים ב-Speaker/cache/bridge/ws).

> **T6 (cache-key sanitization) לא נכלל** — הוא כבר מומש ומחווט בתוך slice 24
> (`sanitizeCacheKey` ב-proxy-cache.ts:63, נקרא ב-http-proxy.ts:97). ה-code review
> נכתב על tip 115419d, לפני שהקוד הזה נכתב.

### Worktree

```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/slice-review-fixes-1 -b slice-review-fixes-1 dev
cd .worktrees/slice-review-fixes-1
pnpm install && pnpm hooks:install
pnpm --filter @drive-coding/frontend exec svelte-kit sync   # worktree טרי — חובה לפני test/typecheck
```

### איך להריץ

- Tests (כל ה-packages, כולל core): `pnpm test` מה-root (core **אין לו** `test` script משלו — הטסטים רצים דרך `vitest.config.ts` ב-root `projects`)
- Tests (FE בלבד): `pnpm --filter @drive-coding/frontend test`
- typecheck: `pnpm typecheck` (אם `TS6305 core/dist` — הרץ `pnpm --filter @drive-coding/core build` קודם, או `rm -f packages/*/tsconfig.tsbuildinfo` ואז שוב)
- build: `pnpm --filter @drive-coding/frontend build`
- lint:i18n: `pnpm lint:i18n`

> אין צורך ב-BE/OneCLI/tunnel ל-slice הזה — הכל logic+adapters. הבדיקה היא
> typecheck + tests + קריאת קוד.

### Browser

לא נדרש.

### OneCLI agent

לא רלוונטי (אין קריאות proxy אמיתיות בטסטים — הכל mock).

### Reading list

**must-read**:
- `packages/frontend/AGENTS.md` — חוקי השכבות (adapters → core בלבד) + חוק זהב #4.
- `packages/frontend/src/lib/adapters/voice/translate.ts` — הדפוס הקיים של timeout+AbortController. Commit 3 מיישר אותו ל-`withTimeout`.
- `packages/core/src/cwd-validate.ts` + `packages/core/tests/cwd-validate.test.ts` — דוגמה לדפוס pure-logic + TDD ב-core.

**reference**:
- `docs/investigations/2026-06-01-full-code-review.md` §F1 (424), §F3 (451), §F7 (468).

---

## §1 — מטרה

תשתית + שני באגים שפוגעים במשתמש תמים:

1. **`withTimeout` helper (חדש)** — פונקציית עזר אחת ב-core שעוטפת כל פעולה אסינכרונית
   ב-timeout, ועובדת בשני המצבים: SDK שמכבד `AbortSignal` (ביטול-רשת אמיתי) ו-SDK
   שמתעלם ממנו (Promise.race משחרר את ה-await בכל מקרה). מחליפה את ההעתקה הידנית
   של דפוס ה-timeout שהיה צריך לחזור על עצמו ב-3+ מקומות.
2. **F3** — אם שירות התמלול (Gemini STT) תלוי, המיקרופון נתקע במצב `transcribing`
   **לנצח**. אחרי ה-fix התמלול נכשל אחרי timeout (דרך `withTimeout`) והמיקרופון חוזר
   ל-idle עם הודעת שגיאה.
3. **F1** — בעמוד ההגדרות, "נשמר ✓" מופיעה ו**נשארת לנצח** במקום להיעלם אחרי 3s.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|------|------|------|
| `withTimeout` helper ב-core + טסטים | ✅ | Commit 0 |
| F3: transcribe דרך `withTimeout` | ✅ | Commit 1 |
| F1: "נשמר" נעלם אחרי 3s | ✅ | Commit 2 |
| יישור translate.ts ל-`withTimeout` | ✅ | Commit 3 |
| F7: timeout ב-voices/tts | ❌ | review-fixes-2 (ייהנה מה-helper) |
| T6: cache-key sanitization | ❌ | כבר ב-slice 24 |
| F2/F4/F9, agents-api timeouts | ❌ | review-fixes-2 |
| H1/H2/H4 (BE) | ❌ | slice נפרד (BE) |

> **למה Commit 3 (יישור translate) כן ב-scope**: השארת translate.ts עם דפוס ידני
> משלו בזמן ש-transcribe משתמש ב-helper = שתי שיטות לאותה בעיה בקוד. מיישרים מיד.
> **למה F7 לא**: הוא ב-voices/tts (fetch, לא generateContent), ולמרות שייהנה מה-helper,
> הוא 🟡 (לא חוסם) ושייך לסבב הבא — שמירה על scope ממוקד.

---

## §3 — Architecture diagram

```
Commit 0 — packages/core/src/async/with-timeout.ts (חדש)
┌────────────────────────────────────────────────────┐
│ withTimeout(fn, ms, opts?)                           │
│   ac = new AbortController()                          │
│   opts.signal → ac.abort (ביטול חיצוני)              │
│   timeout = Promise(reject after ms + ac.abort)       │
│   work = fn(ac.signal)                                │
│   work.catch(()=>{})   ← בולע rejection של המפסיד    │
│   try { return await Promise.race([work, timeout]) }  │
│   finally { clearTimeout }                            │
└──────────────┬───────────────────────┬───────────────┘
               │ Commit 1              │ Commit 3
               ▼                       ▼
┌──────────────────────────┐  ┌──────────────────────────┐
│ transcribe.ts            │  │ translate.ts             │
│  fn מתעלם מ-signal       │  │  fn מעביר signal ל-`ai`  │
│  (SDK לא מכבד abort)     │  │  SDK (כן מכבד abort)     │
│  → race משחרר את await   │  │  → גם abort וגם race      │
│  → זורק → Mic catch idle │  │  → מחזיר null בשגיאה      │
└──────────────────────────┘  └──────────────────────────┘
               ▲
   ┌───────────┴────────────┐
   │ mic.svelte.ts          │ ← לא משתנה. ה-catch הקיים (~79-81)
   │ await transcribe(blob) │   תופס את ה-throw ומחזיר ל-idle
   └────────────────────────┘

Commit 2 — routes/settings/+page.svelte (נפרד, לא קשור ל-helper)
  showSaved = $derived(savedAt !== undefined)   ← פשוט
  $effect: כש-savedAt משתנה → setTimeout(3000) מאפס savedAt (cleanup ב-return)
```

---

## §4 — Commits בסדר

### Commit 0 — `withTimeout` helper ב-core (approach: tdd)

**קבצים חדשים**:
- `packages/core/src/async/with-timeout.ts`
- `packages/core/tests/async/with-timeout.test.ts`

**קבצים שמשתנים**:
- `packages/core/package.json` — מוסיף export `"./async/*": "./src/async/*.ts"` (additive, לא משנה קיימים).

**API skeleton** (החתימה המדויקת — executor אסור לשנות):

```ts
/**
 * עוטף פעולה אסינכרונית ב-timeout. עובד בשני מצבים:
 *  - SDK שמכבד AbortSignal: ה-fn מעביר את ה-signal הלאה → ביטול-רשת אמיתי.
 *  - SDK שמתעלם מ-AbortSignal: ה-Promise.race דוחה אחרי ms בכל מקרה → משחרר את ה-await.
 * זורק (rejects) עם Error("...timeout...") כשהזמן עובר.
 */
export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
  opts?: { signal?: AbortSignal; label?: string },
): Promise<T>
```

**גוף מחייב** (טפל מפורשות בשני הדברים שעלולים להישכח בהעתקה ידנית):

```ts
export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
  opts?: { signal?: AbortSignal; label?: string },
): Promise<T> {
  const ac = new AbortController()
  opts?.signal?.addEventListener("abort", () => ac.abort(), { once: true })

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ac.abort()  // best-effort: לקטוע את הבקשה ברשת אם ה-SDK תומך
      reject(new Error(`${opts?.label ?? "operation"} timeout ${ms}ms`))
    }, ms)
  })

  const work = fn(ac.signal)
  // ① בולע rejection של הצד שמפסיד ב-race — מונע unhandled rejection
  //    כש-ה-SDK דוחה (AbortError) אחרי שה-timeout כבר ניצח.
  //    ה-reference המקורי (work) עדיין מועבר ל-race, אז הקורא מקבל את השגיאה אם work מפסיד.
  void work.catch(() => {})

  try {
    return await Promise.race([work, timeout])
  } finally {
    // ② מנקה את ה-timer לכל כיוון — אם work ניצח, ה-setTimeout לא צריך לירות.
    clearTimeout(timer)
  }
}
```

**טסט (TDD — אדום קודם)**: `with-timeout.test.ts` — `vi.useFakeTimers()` ב-beforeEach,
`vi.useRealTimers()` ב-afterEach. כיסוי:

1. **happy path**: `fn` נפתר מהר → `withTimeout` מחזיר את הערך. (ודא שלא נתלה.)
2. **timeout — SDK שמתעלם מ-abort**: `fn = () => new Promise(() => {})` (לעולם לא נפתר, מתעלם מ-signal). `vi.advanceTimersByTime(ms)` → `withTimeout` **דוחה** עם error שמכיל "timeout". זה מאמת שה-race משחרר את ה-await ללא תלות ב-SDK.
3. **abort propagation — SDK שמכבד abort**: `fn = (signal) => new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("aborted"))))`. advance ל-ms → ה-signal עבר abort (ה-fn קיבל אותו). ודא שה-promise דוחה.
4. **external signal**: `opts.signal` שכבר עבר abort (או עובר abort ידני) → ה-fn מקבל signal ש-aborted, ו-`withTimeout` דוחה. (ביטול ידני, לא timeout.)
5. **timer cleanup**: `fn` נפתר מהר → spy על `clearTimeout` (או ודא שאחרי resolve אין callback מאוחר עם advance) — אין timer דולף.
6. **no unhandled rejection**: `fn` דוחה **אחרי** שה-timeout ניצח. הרצה: התחל `withTimeout` עם `fn` שדוחה רק כשה-signal עובר abort; advance ל-timeout (timeout מנצח); ה-`fn` נדחה כתוצאה מ-abort. ודא שאין unhandled rejection — אפשר עם `process.on("unhandledRejection")` listener שנכשל אם נורה, או ע"י בדיקה שה-`void work.catch` קיים (review). **זה הטסט הכי חשוב — בלי ① הוא ייכשל.**

**Verification**:
```bash
pnpm test   # מה-root — מריץ את כל ה-projects כולל core (ל-core אין test script משלו)
pnpm typecheck
```

### Commit 1 — F3: transcribe דרך `withTimeout` (approach: tdd)

**קבצים שמשתנים**:
- `packages/frontend/src/lib/adapters/voice/transcribe.ts`

**קבצים חדשים**:
- `packages/frontend/src/lib/adapters/voice/transcribe.test.ts`

**מה לעשות** — עטוף את ה-`generateContent` ב-`withTimeout`. החתימה הציבורית של
`transcribe(blob, opts)` **לא משתנה**. `@google/genai` לא מובטח שמכבד abortSignal,
לכן ה-`fn` מעביר את ה-signal כ-best-effort בלבד וה-race עושה את העבודה:

```ts
import { withTimeout } from "@drive-coding/core/async/with-timeout"

const TRANSCRIBE_TIMEOUT_MS = 15000  // STT איטי מתרגום — חלון רחב

// ... בתוך הפונקציה, במקום ה-await הישיר:
const response = await withTimeout(
  (signal) =>
    googleGenAi().models.generateContent({
      model: "gemini-flash-latest",
      contents: [/* ... ללא שינוי ... */],
      config: { abortSignal: signal } as Record<string, unknown>,  // best-effort
    }),
  TRANSCRIBE_TIMEOUT_MS,
  { signal: opts.signal, label: "transcribe" },
)
const { id: recordingId } = await recordingPromise
const text = response.text ?? ""
return { text, recordingId }
```

**הבדל מתוכנן מ-translate**: transcribe **זורק** (לא מחזיר null) — כי ה-Mic VM כבר
תופס את החריגה ב-catch ומחזיר ל-idle (mic.svelte.ts, ה-catch סביב `await transcribe`).
**אל תוסיף try/catch ב-transcribe** — תן ל-throw של `withTimeout` להתפשט.

> **הערה (אביגיל finding 7)**: ה-caller היחיד `mic.svelte.ts:75` קורא `transcribe(blob)`
> **בלי** opts → `opts.signal` תמיד undefined כרגע. זה **לא מזיק** — `withTimeout` עובד
> מצוין בלי external signal (ה-race משחרר את ה-await; ה-timeout עצמו מספק את הקטיעה).
> ה-`{ signal: opts.signal }` נשאר ב-pseudo-code לתמיכה עתידית (אם Mic יעביר signal
> לביטול ידני) — אבל אל תצפה שהוא פעיל ב-runtime עכשיו. אל "תתקן" את זה ב-Mic.

**טסט**: `transcribe.test.ts` — `vi.mock` ל-`./sdks` (googleGenAi) וכן `vi.mock` ל-`@drive-coding/core/async/with-timeout` **לא נדרש** (משתמשים ב-helper האמיתי).
- happy: generateContent מחזיר `{ text: "שלום" }` מהר → `transcribe` מחזיר `{ text: "שלום", recordingId: "" }`.
- timeout: generateContent תלוי לנצח (`new Promise(()=>{})`) + fake timers advance ל-15000 → `transcribe` **דוחה** (mic flow יחזיר ל-idle). מאמת ש-F3 נסגר.

> **מיקום ה-catch ב-mic.svelte.ts הוא reference בלבד** — אם slice 6 ימוזג לפני
> slice זה, השורות יזוזו (slice 6 מוסיף cue lines ב-mic). F3 עורך רק transcribe.ts.
> אין merge conflict.

**Verification**:
```bash
pnpm --filter @drive-coding/frontend test
pnpm typecheck
```

### Commit 2 — F1: "נשמר" נעלם אחרי 3 שניות (approach: manual)

**קבצים שמשתנים**:
- `packages/frontend/src/routes/settings/+page.svelte`

החלף את שורה 23:
```ts
let showSaved = $derived(savedAt !== undefined && Date.now() - savedAt < 3000)
```
ב:
```ts
let showSaved = $derived(savedAt !== undefined)

$effect(() => {
  if (savedAt === undefined) return
  const timer = setTimeout(() => {
    savedAt = undefined
  }, 3000)
  return () => clearTimeout(timer)
})
```

**רציונל**: `$derived` עם `Date.now()` לא מתחשב מחדש (לא reactive). ה-`$effect` מגיב
ל-`savedAt` (reactive), מפעיל timer שמאפס אותו → ה-derived מחושב מחדש → ההודעה נעלמת.
ה-cleanup מבטל timer קודם בשמירה חוזרת.

> **לא משתמש ב-`withTimeout`** — זה timer של UI reactivity, לא פעולה אסינכרונית
> שצריך לעטוף. ה-helper לא רלוונטי כאן.
> **חוק זהב #4**: `savedAt` הוא `$state` מקומי ב-route (UI transient — מותר ב-route),
> אז ה-effect שמנהל אותו נשאר ב-route. זה לא side-effect חיצוני אסור.

**Verification**:
```bash
pnpm typecheck
pnpm --filter @drive-coding/frontend build
# קריאת קוד: showSaved=$derived(savedAt!==undefined), $effect עם setTimeout 3000 + clearTimeout ב-return
```

### Commit 3 — יישור translate.ts ל-`withTimeout` (approach: tdd)

**קבצים שמשתנים**:
- `packages/frontend/src/lib/adapters/voice/translate.ts`

החלף את הבלוק הידני (שורות 75-105: AbortController+setTimeout+try/catch/finally) בקריאה
ל-`withTimeout`. **שמור על ההתנהגות הקיימת**: translate מחזיר `null` בשגיאה/ביטול/timeout
(הקורא מתייחס ל-null כ"דלג על תרגום"). לכן עוטפים את `withTimeout` ב-try/catch שמחזיר null:

```ts
import { withTimeout } from "@drive-coding/core/async/with-timeout"

// ... במקום הבלוק הידני:
try {
  const result = await withTimeout(
    (signal) => generateObject({
      model: googleAi("gemini-flash-lite-latest"),
      schema: translateSchema,
      prompt,
      abortSignal: signal,
    }),
    TIMEOUT_MS,
    { signal, label: "translate" },
  )
  const obj = result.object
  if (obj.status === "translated" && obj.text.trim().length === 0) {
    console.warn("translate returned empty text — treating as failure", { len: text.length })
    return null
  }
  return obj
} catch (e) {
  console.warn("translate failed", { err: e instanceof Error ? e.message : String(e), len: text.length })
  return null
}
```

> **שים לב לשמות**: הפרמטר החיצוני של translate נקרא `signal` (לא `opts.signal`).
> ה-`{ signal, label }` מעביר אותו ל-helper. ה-`ai` SDK **כן** מכבד abortSignal, אז
> כאן ה-signal עושה ביטול-רשת אמיתי **וגם** ה-race מגן — שני העולמות.

**טסט**: `translate.test.ts` קיים? בדוק — אם קיים, ודא שעדיין ירוק (ההתנהגות זהה:
מחזיר null בשגיאה/timeout). אם לא קיים, אין חובה להוסיף (regression מכוסה ע"י
typecheck + התנהגות שמורה), אבל מומלץ טסט timeout→null אחד.

**Verification**:
```bash
pnpm --filter @drive-coding/frontend test
pnpm typecheck
```

---

## §5 — DoD verifiable

| # | בדיקה | איך |
|---|------|------|
| 1 | typecheck נקי | `pnpm typecheck` (אחרי core build אם צריך) |
| 2 | build נקי | `pnpm --filter @drive-coding/frontend build` |
| 3 | core tests עוברים (כולל with-timeout) | `pnpm test` מה-root (כולל core — אין לו test script נפרד) |
| 4 | FE tests עוברים | `pnpm --filter @drive-coding/frontend test` |
| 5 | lint:i18n נקי | `pnpm lint:i18n` |
| 6 | `withTimeout` exported | קריאת קוד: `package.json` יש `"./async/*"`, הקובץ קיים, מיובא ב-transcribe+translate |
| 7 | helper: no unhandled rejection | `with-timeout.test.ts` כולל את טסט #6 (fn דוחה אחרי timeout) והוא ירוק |
| 8 | helper: timer cleanup | `with-timeout.test.ts` טסט #5 ירוק (אין timer דולף) |
| 9 | F3: transcribe דרך withTimeout | קריאת קוד: transcribe קורא `withTimeout(...)`, **לא** AbortController ידני |
| 10 | F3: transcribe זורק (לא null) | קריאת קוד: אין catch שמחזיר null ב-transcribe |
| 11 | F3: טסט timeout | `transcribe.test.ts`: generateContent תלוי לנצח → transcribe דוחה |
| 12 | F1: showSaved פשוט + timer | קריאת קוד: `$derived(savedAt!==undefined)` + `$effect` עם setTimeout 3000 + clearTimeout |
| 13 | Commit 3: translate עדיין מחזיר null | קריאת קוד: try/catch סביב withTimeout מחזיר null; טסט (אם קיים) ירוק |
| 14 | regression: translate בפועל | `pnpm --filter @drive-coding/frontend test` — אין רגרסיה |

---

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|------|------|----------|
| Hardcoded Hebrew strings | learnings | אין מחרוזות חדשות — i18n keys קיימים (`mic.error.transcribe`, `settings.beUrl.saved`). `pnpm hooks:install` + `pnpm lint:i18n` |
| **unhandled rejection ב-race** | החלטה (2026-06-02) | ה-`void work.catch(()=>{})` בגוף ה-helper בולע את ה-rejection של הצד המפסיד. **טסט #6 מאמת.** בלי זה — אזהרת קונסול/crash כש-SDK דוחה אחרי timeout |
| timer דולף | החלטה | `clearTimeout` ב-`finally` (כל כיוון). טסט #5 |
| Svelte 5 `$effect` infinite loop | learnings 2026-05-16 | F1: ה-effect כותב `savedAt` בתוך callback של setTimeout (אסינכרוני, לא בגוף ה-effect) + `if undefined return` → לא לולאה |
| F3 שובר Mic flow | חדש | transcribe **זורק**. ה-Mic VM כבר תופס ב-catch. אל תוסיף catch ב-transcribe |
| Commit 3 משנה התנהגות translate | חדש | translate **חייב** להמשיך להחזיר null בשגיאה/timeout. ה-try/catch סביב withTimeout שומר על זה. DoD#13/#14 |
| מיקום ה-catch ב-mic.svelte.ts stale | חדש | reference בלבד (לא edit target). חפש `catch` סביב `await transcribe`, לא לפי מספר שורה |
| fake timers — אין תקדים ב-core | חדש | `with-timeout.test.ts` יהיה הראשון להשתמש ב-`vi.useFakeTimers()` ב-core. דפוס סטנדרטי, אין config מיוחד נדרש ב-vitest |

---

## §7 — Escalation triggers

עצור ושאל את מרדכי אם:
- `vitest` ב-core לא תומך ב-fake timers בלי config נוסף (לא צפוי).
- ה-`void work.catch` לא מספיק למניעת unhandled rejection בסביבת הטסט (אולי צריך גישה אחרת).
- צריך לשנות את החתימה הציבורית של `transcribe` או `translate`.
- ה-`$effect` ב-F1 מייצר warning של reactivity loop.
- export `./async/*` מתנגש עם משהו קיים (לא צפוי — אין src/async).

---

## §8 — Complexity score + verifier tier

| פרמטר | ניקוד |
|------|------|
| State machine / async coordination (Promise.race, abort, cleanup) | +2 |
| Refactor של קוד קיים (transcribe + translate) | +1 |
| ספרייה חדשה (helper חדש ב-core, אך זעיר ו-pure) | +1 |
| >5 files ב->2 packages (core + frontend) | +1 |
| Pure logic, אין IO (ה-helper עצמו) | -2 |
| TDD מלא (helper + F3) | -1 |
| Greenfield (helper — אין call sites קודמים) | -1 |

**Score**: 4 / 10 (1 ←העלאה מ-2 בגלל ה-helper + race/cleanup semantics)

**Tier**: `calev` mode: light. שקול verifier-phase על Commit 0 (ה-helper) — הוא הלב.

**Verifier-phase**: Commit 0 (ה-helper — אם calev light לא מספיק לאמת את ה-no-unhandled-rejection, phase-check אחרי Commit 0).

---

## §9 — שאלות פתוחות

| # | שאלה | הכרעה | חוסם? |
|---|------|----------|------|
| 1 | `Promise.race` שמסתיים לפני שה-abort "סיים" — בעיה? | **הוכרע — לא בעיית נכונות.** ה-abort הוא best-effort cleanup, לא תנאי לסיום. שתי ההשלכות (unhandled rejection + timer leak) מטופלות בגוף ה-helper (① ②) ומכוסות בטסטים #5/#6. | ❌ (הוכרע) |
| 2 | TRANSCRIBE_TIMEOUT_MS = 15000 סביר? | כן — STT של webm audio ~5-10s טיפוסי | ❌ |
| 3 | להעביר את ה-helper גם ל-F7 (voices/tts)? | לא בסבב הזה — F7 הוא 🟡, נשמר ל-review-fixes-2 (ייהנה מה-helper הקיים) | ❌ |

> **הכרעת Q1 (תיעוד החלטה)**: ה-helper תמיד עושה `Promise.race` (משחרר await ללא
> תלות ב-SDK) **וגם** תמיד מספק `AbortSignal` (ביטול-רשת כש-SDK תומך). הצד המפסיד
> ב-race עלול לדחות אחרי שהפסיד → `void work.catch(()=>{})` בולע. ה-timer מנוקה
> ב-finally. אלה בדיוק 2 הדברים שקל לשכוח בהעתקה ידנית — ולכן helper אחד מטופל-היטב
> עדיף על 4 inline copies.

---

## סטיות מהתכנון (מתעדכן ע"י executor תוך כדי)

- **withTimeout refactor (Commit 0)**: הפרדת `timeout` Promise constructor מ-timer הפעלה — `timeoutReject` נשמר מחוץ לconstructor, `void timeout.catch(()=>{})` נרשם לפני `timer = setTimeout(...)`. הסיבה: vitest@4.1.6 + jsdom fake timers יוצרים `PromiseRejectionHandledWarning` כש-reject נקרא ב-`setImmediate` callback לפני שה-catch handler "מחובר" מנקודת מבט Node.js. השינוי שומר על הסמנטיקה המלאה של ה-brief.
- **transcribe.test.ts (Commit 1)**: withTimeout mocked במקום fake timers. הסיבה: `vi.useFakeTimers()` ב-jsdom עם `vi.advanceTimersByTimeAsync` גורם לאותה בעיה של `PromiseRejectionHandledWarning`. לוגיקת timeout מכוסה ב-`with-timeout.test.ts` בcore. הטסט מאמת ש-throw מתפשט מ-withTimeout ל-caller.
- **translate.test.ts (Commit 3)**: withTimeout mocked (אותה סיבה). 5 טסטים במקום 1 מומלץ — הוסף coverage מלא.
