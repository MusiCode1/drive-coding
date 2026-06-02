# Slice sessions-inline + transcribe-resilience — תוכנית

> **תאריך**: 2026-06-02
> **סטטוס**: ✅ **הושלם** — 2026-06-02. 5 commits (d7d6519..164a191). calev light GO (17/17).
> **Complexity**: 6/10 (verifier: light + phase על Commit 4)
> **תלויות (`depends_on`)**: [] — הכל כבר ב-dev (redesign-7 + with-timeout מוזגו ב-`266322f`)
> **Base**: dev (`266322f`)
> **Dev tip**: `266322f`

---

## §0 — Pre-flight

> סוכן חדש בלי context צריך לדעת אחרי הסעיף הזה איך להריץ הכל.

### תלויות (חובה!)

slice זה **אין לו תלויות** — בנוי ישירות על `dev`. כל מה שהוא צריך כבר merged:
- `with-timeout.ts` (`@drive-coding/core/async/with-timeout`) — קיים ב-dev (review-fixes-1).
- `transcribe.ts` עם withTimeout — קיים ב-dev.
- `SessionOptionsPanel.svelte` עם שורת-פעולות עליונה + modelGroups (B6/B7) — קיים ב-dev.
- `AcpClient.listSessions()` — קיים ב-`packages/core/src/acp/client.ts:48`.

> אביגיל: ודאי ש-`depends_on: []` ב-state.json עקבי עם זה. ה-base הוא dev tip `266322f`.

### Worktree

```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/slice-sessions-inline-transcribe -b slice-sessions-inline-transcribe dev
cd .worktrees/slice-sessions-inline-transcribe
pnpm install && pnpm hooks:install
pnpm --filter @drive-coding/frontend-v2 exec svelte-kit sync   # worktree טרי
```

### איך להריץ

- **Tests**: `pnpm test` מה-root (כולל core). FE בלבד: `pnpm --filter @drive-coding/frontend-v2 test`
- **typecheck**: `pnpm --filter @drive-coding/frontend-v2 typecheck`
  - אם `TS6305 core/dist`: `find packages -name '*.tsbuildinfo' -delete` ואז `pnpm --filter @drive-coding/core build` לפני typecheck.
- **build**: `pnpm --filter @drive-coding/frontend-v2 build`
- **lint:i18n**: `pnpm lint:i18n` (חוסם מחרוזות עברית בקוד — חובה לפני commit)
- **BE (לחלק A — סשנים אמיתיים + חלק B — תמלול)**: צריך BE עם OneCLI:
  ```bash
  cd packages/backend
  PORT=4011 onecli run --agent voice-acp -- bun --watch src/server.ts
  ```
  ואז FE: `BE_PORT=4011 pnpm --filter @drive-coding/frontend-v2 dev --port <os-assigned>`

> ⚠️ פורט 4011 (לא 4010 — שם רץ ה-int-all הזמני). בחר פורט פנוי אם תפוס.

### Browser

- בדיקת UI: linux-gui Chrome (session `vacp`):
  `ssh linux-gui "... playwright-cli -s=vacp goto <url>"`. ראה skill `linux-gui-browser`.
- חלק B (תמלול) דורש מיקרופון — קשה לאוטומציה. בדיקה ידנית/manual של זרימת ה-retry,
  או mock של `transcribe` שזורק כדי לאמת את כפתור "נסה שוב".

### OneCLI agent

שם: `voice-acp`. מזריק `xi-api-key` ל-ElevenLabs, `x-goog-api-key` ל-Google.
חלק B (transcribe) עובר דרך `/proxy/google/*` → דורש OneCLI.

### Reading list

**must-read** (לפני שמתחילים):
- `packages/core/src/async/with-timeout.ts` — דפוס ה-helper לחיקוי ל-`with-retry`.
- `packages/core/tests/async/with-timeout.test.ts` — דפוס הטסט (fake-timers) לחיקוי. ⚠️ טסטי core ב-`tests/async/`, לא `src/async/`.
- `packages/frontend/src/lib/adapters/voice/transcribe.ts` — מה שעוטפים ב-retry (חלק B).
- `packages/frontend/src/lib/view-models/mic.svelte.ts` — ה-state machine של ה-mic (חלק B).
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts` — מוסיפים פה state+listSessions (חלק A).
- `packages/frontend/src/lib/adapters/sessions.ts` — ה-spawn החד-פעמי (חלק A, fallback).
- `packages/frontend/src/lib/components/layout/SessionOptionsPanel.svelte` — placeholder סשנים שממלאים (חלק A).
- `packages/frontend/AGENTS.md` — 5 חוקי הזהב (במיוחד #2 entity, #4 side-effect owner).

**reference**:
- `packages/core/src/acp/client.ts:48` — `AcpClient.listSessions()` חתימה.
- `packages/frontend/src/lib/components/modals/SessionsDialog.svelte` — נמחק בחלק A.
- `packages/frontend/src/lib/components/modals/SessionCard.svelte` — נשאר (מוצג inline).

---

## §1 — מטרה

שני שיפורים בלתי-תלויים בחוויית המשתמש:

**חלק A — סשנים inline**: היום רשימת הסשנים ב-SessionOptionsPanel (sidebar/sheet) ריקה,
וטעינתה פותחת **סוכן חד-פעמי חדש** (spawn יקר, ~300-700ms + סיכון bridge-leak) גם כשכבר
יש סשן פעיל. אחרי ה-slice: כשיש חיבור פעיל, הרשימה נטענת דרך **החיבור הקיים**
(`session.listSessions()`) — ללא spawn. נשמרת ב-cache, מתרעננת בכפתור מפורש, ומאפשרת
מעבר בין סשנים. ה-SessionsDialog המיותר נמחק.

**חלק B — עמידות תמלול**: היום כשל בתמלול (socket-close לסירוגין מ-Google, או timeout)
מציג "התמלול נכשל" פעם אחת — בלי ניסיון חוזר ובלי דרך לנסות שוב. אחרי ה-slice: timeout
מוגדל (30s), retry אוטומטי עם backoff (כשל transport זמני נעלם בניסיון השני), וכפתור
"נסה שוב" שמשתמש בהקלטה השמורה (אם הכל נכשל — אפשר לנסות בעוד כמה דקות).

> שני החלקים **בלתי-תלויים** (A: AgentSession+SessionOptionsPanel; B: with-retry+transcribe+Mic).
> commits נפרדים — כל אחד עומד בנפרד.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|------|------|------|
| `with-retry.ts` helper ב-core (exponential backoff) | ✅ | Commit 0 |
| transcribe: timeout 15s→30s | ✅ | Commit 1 |
| transcribe: retry אוטומטי (withRetry) | ✅ | Commit 1 |
| Mic: שמירת blob + מצב error + `retryTranscribe()` | ✅ | Commit 2 |
| UI: כפתור "נסה שוב" כשהתמלול נכשל | ✅ | Commit 2 |
| `AgentSession.listSessions()` + state+cache | ✅ | Commit 3 |
| SessionOptionsPanel: רשימה inline + רענון + בחירה | ✅ | Commit 4 |
| מחיקת SessionsDialog + modals.sessions | ✅ | Commit 4 |
| **החלפת מודל התמלול** (flash-latest→אחר) | ❌ | **לא** — החלטת משתמשת, נשארים על flash-latest |
| voices retry → with-retry האחיד (refactor) | ❌ | סבב נפרד — לא לגעת ב-settings.loadVoices הקיים |
| dev page (`/`) SessionPicker → listSessions החדש | ❌ | סבב נפרד — דף החיבור נשאר עם spawn (אין שם חיבור פעיל) |
| NotificationsVM (טיפול שגיאות מרכזי) | ❌ | slice עתידי נפרד |

> ה-spawn החד-פעמי (`listSessionsForCwd`) **נשאר** — הוא ה-fallback לדף החיבור (שם אין
> חיבור פעיל). חלק A רק מוסיף מסלול שני (דרך החיבור הקיים) לשימוש ב-SessionOptionsPanel.

---

## §3 — Architecture diagram

```
חלק B — עמידות תמלול:
┌──────────────────────────┐
│ core/async/with-retry.ts │ ← חדש (דפוס כמו with-timeout)
│ withRetry(fn, opts)      │
└───────────┬──────────────┘
            │
            ▼
┌──────────────────────────┐      ┌─────────────────────┐
│ transcribe.ts            │      │ Mic (mic.svelte.ts) │ ← state INVASIVE
│ withRetry(withTimeout(   │◄─────│ #lastBlob, error,   │
│   generateContent),30s)  │      │ retryTranscribe()   │
└──────────────────────────┘      └──────────┬──────────┘
                                              │
                                  ┌───────────▼──────────┐
                                  │ MicError UI component │ ← כפתור "נסה שוב"
                                  └───────────────────────┘

חלק A — סשנים inline:
┌────────────────────────────────┐
│ AgentSession (INVASIVE state)  │
│ sessions/sessionsLoading/Error │ ← חדש
│ listSessions(force?)           │ ← משתמש ב-#client.listSessions() הקיים
└───────────────┬────────────────┘
                │ (אם אין #client — לא טוען. דף החיבור משתמש ב-spawn נפרד)
                ▼
┌────────────────────────────────┐
│ SessionOptionsPanel.svelte     │ ← ממלא את ה-placeholder (שורות ~272-274)
│ - רענון → session.listSessions │
│ - SessionCard לכל סשן          │
│ - בחירה → detach + loadSession │
└────────────────────────────────┘
        SessionsDialog.svelte ← נמחק   modals.sessionsOpen ← נמחק
```

---

## §4 — Commits בסדר

> **חלק B (Commits 0-2) ו-חלק A (Commits 3-4) בלתי-תלויים.** מומלץ לבצע B קודם (קצר
> וברור), אבל הסדר לא קריטי. כל commit עומד בפני עצמו ועובר typecheck+test.

### Commit 0 — with-retry helper ב-core (approach: tdd)

**קבצים חדשים**:
- `packages/core/src/async/with-retry.ts`
- `packages/core/tests/async/with-retry.test.ts`  ⚠️ הטסט ב-`tests/async/` (קונבנציית core — mirror של src/), **לא** ב-src/async/. ראה `with-timeout.test.ts` שם.

**מה לעשות** — helper גנרי ל-retry עם exponential backoff. ניתן-לבדיקה (pure, ללא DOM/Svelte).
דפוס מקביל ל-`with-timeout.ts` (אותה תיקייה). זה ה-helper האחיד שישמש את transcribe
(וכל מי שירצה retry בעתיד — TODO ב-memory על איחוד voices.loadVoices אליו, **לא בסבב הזה**).

**API skeleton** (החתימה המדויקת — executor אסור לשנות):

```ts
export type RetryOptions = {
  /** מספר נסיונות מקסימלי (כולל הראשון). ברירת מחדל 3. */
  retries?: number
  /** השהיה בסיסית (ms) לפני הנסיון השני. מוכפלת אקספוננציאלית. ברירת מחדל 500. */
  baseDelayMs?: number
  /** תקרת השהיה (ms). ברירת מחדל 5000. */
  maxDelayMs?: number
  /** signal לביטול חיצוני — קוטע גם את ה-fn וגם את ה-sleep בין נסיונות. */
  signal?: AbortSignal
  /** מחזיר true אם השגיאה ראויה ל-retry. ברירת מחדל: כל שגיאה (() => true). */
  shouldRetry?: (err: unknown) => boolean
  /** label ללוג. */
  label?: string
}

/**
 * מריץ את fn עד retries פעמים. בכשל — ממתין delay (exponential: base*2^attempt,
 * capped ל-max) ומנסה שוב. אם כל הנסיונות נכשלו — זורק את השגיאה האחרונה.
 * signal.abort קוטע מיד (זורק AbortError / DOMException). אם shouldRetry מחזיר
 * false — זורק מיד בלי retry.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts?: RetryOptions,
): Promise<T>
```

**דרישות מימוש**:
- ה-`fn` מקבל את מספר ה-attempt (0-based) — שימושי ל-logging.
- בין נסיונות: `sleep(min(baseDelayMs * 2**attempt, maxDelayMs))` — אבל ה-sleep חייב
  להיות **בר-ביטול** ע"י ה-signal (אל תשתמש ב-`setTimeout` עירום שלא מקשיב ל-abort;
  עטוף ב-Promise שמאזין ל-`signal` ו-rejects ב-abort, עם `clearTimeout` ב-cleanup).
- אם `signal` כבר aborted בכניסה — זרוק מיד.
- אם `shouldRetry(err) === false` — זרוק מיד (אל תמשיך ל-retry).
- אחרי הנסיון האחרון — זרוק את השגיאה האחרונה (לא לבלוע).

**טסט** (tdd — כתוב לפני המימוש):
- happy: fn מצליח בנסיון 1 → נקרא פעם אחת, מחזיר את הערך.
- retry-then-success: fn נכשל פעם אחת ואז מצליח → נקרא פעמיים, מחזיר את הערך (השתמש ב-fake timers + `advanceTimersByTimeAsync` ל-baseDelay).
- exhausted: fn תמיד נכשל, retries=3 → נקרא 3 פעמים, זורק את השגיאה האחרונה.
- backoff timing: עם retries=4, ודא שההשהיות הן base, base*2, base*4 (capped ל-max).
- shouldRetry=false: fn נכשל עם שגיאה ש-shouldRetry דוחה → נקרא פעם אחת, זורק מיד.
- signal abort: signal.abort() באמצע ה-sleep → זורק, ה-fn לא נקרא שוב.

> ⚠️ fake-timers + Promise: ראה `packages/core/tests/async/with-timeout.test.ts` — אותו דפוס
> `vi.useFakeTimers()` + `advanceTimersByTimeAsync`. רשום `.catch` לפני advance למניעת
> unhandled rejection.

**Verification**:
```bash
pnpm --filter @drive-coding/core test -- with-retry
pnpm --filter @drive-coding/core build
pnpm typecheck
```

### Commit 1 — transcribe: timeout 30s + retry (approach: tdd)

**קבצים שמשתנים**:
- `packages/frontend/src/lib/adapters/voice/transcribe.ts`

**קבצים חדשים** (אם אין):
- `packages/frontend/src/lib/adapters/voice/transcribe.test.ts` (אם קיים — הרחב)

**מה לעשות**:
1. `TRANSCRIBE_TIMEOUT_MS = 15000` → `30000` (ראינו 5-10s ל-"hi" עם thinking; אודיו אמיתי ארוך יותר).
2. עטוף את ה-`withTimeout(...)` הקיים (שורות 50-64) ב-`withRetry`. כלומר:
   `withRetry(() => withTimeout(generateContent, 30s), { retries: 3, baseDelayMs: 800, label: "transcribe" })`.
   ה-retry מטפל ב-socket-close/timeout הלסירוגיני; כל נסיון מקבל timeout 30s משלו.
3. **שמור על החתימה** `transcribe(blob, opts?)` ועל ה-`opts.signal` — ה-signal עובר גם
   ל-withRetry (לביטול חיצוני) וגם ל-withTimeout (דרך ה-fn). חשוב: signal aborted →
   לא לנסות שוב.

**מבנה מוצע** (החתימה החיצונית של transcribe לא משתנה):
```ts
import { withRetry } from "@drive-coding/core/async/with-retry"
const TRANSCRIBE_TIMEOUT_MS = 30000

const response = await withRetry(
  () =>
    withTimeout(
      (signal) =>
        googleGenAi().models.generateContent({
          model: "gemini-flash-latest",   // ← לא משנים מודל (החלטת משתמשת)
          contents: [/* ... ללא שינוי ... */],
          config: { abortSignal: signal } as Record<string, unknown>,
        }),
      TRANSCRIBE_TIMEOUT_MS,
      { signal: opts.signal, label: "transcribe" },
    ),
  { retries: 3, baseDelayMs: 800, maxDelayMs: 4000, signal: opts.signal, label: "transcribe" },
)
```

> שים לב: ה-`opts.signal` מועבר **לשתי** השכבות. אם המשתמש מבטל (signal.abort), גם
> ה-withTimeout הנוכחי נקטע וגם ה-withRetry לא מנסה שוב.

**טסט**: mock את `googleGenAi` (כמו בטסט הקיים). כסה:
- happy: generateContent מצליח → transcribe מחזיר text, נקרא פעם אחת.
- retry: generateContent זורק פעם אחת (socket error) ואז מצליח → transcribe מחזיר text,
  נקרא פעמיים (fake timers ל-baseDelay).
- exhausted: תמיד זורק → transcribe זורק אחרי 3 נסיונות.

> אם fake-timers בעייתי עם ה-SDK mock — אפשר למקק את `withRetry`/`withTimeout` ולבדוק
> רק שה-generateContent נקרא, כמו שעשו ב-review-fixes (mock של withTimeout).

**Verification**:
```bash
pnpm --filter @drive-coding/frontend-v2 test -- transcribe
pnpm typecheck
```

### Commit 2 — Mic: blob + retryTranscribe + כפתור "נסה שוב" (approach: integration)

**קבצים שמשתנים**:
- `packages/frontend/src/lib/view-models/mic.svelte.ts` — **INVASIVE state** (אישור משתמשת)
- הרכיב שמציג `mic.error` — מצא אותו: `grep -rn "mic.error\|getMic" packages/frontend/src --include=*.svelte`
  (ככל הנראה ב-`ChatInput.svelte` או `MicButton.svelte` — אמת בקוד).
- `packages/core/src/i18n/{keys.ts,catalogs/he.ts,catalogs/en.ts}` — מפתח `mic.retry`.

**שינוי ה-state ב-Mic** (mic.svelte.ts):
- הוסף שדה פרטי `#lastBlob: Blob | null = null`.
- בבלוק ה-`recording → transcribing` (שורות ~64-97): אחרי `recorder.stop()` שמור
  `this.#lastBlob = blob`. ב-catch של `transcribe` (שורה ~85-90): **אל תזרוק את ה-blob** —
  השאר אותו ב-`#lastBlob`, הצב `error = "mic.error.transcribe"`, `state = "idle"`.
  בהצלחה: `this.#lastBlob = null` (לא צריך יותר).
- הוסף מתודה ציבורית:
  ```ts
  /** מנסה שוב לתמלל את ההקלטה האחרונה ששמורה (אחרי כשל). no-op אם אין blob שמור. */
  retryTranscribe = async (): Promise<void> => {
    if (this.#lastBlob === null) return
    if (this.state !== "idle") return
    this.state = "transcribing"
    this.error = null
    try {
      const { text, recordingId } = await transcribe(this.#lastBlob)
      this.#lastBlob = null
      if (text.trim().length > 0) {
        void this.#session.sendPrompt(text, { recordingId })
      }
      this.state = "idle"
    } catch (e) {
      console.warn("[mic] retryTranscribe failed", e)
      this.error = "mic.error.transcribe"   // ה-blob נשאר — אפשר לנסות שוב
      this.state = "idle"
    }
  }
  ```
- הוסף getter ציבורי `get canRetry(): boolean { return this.#lastBlob !== null }` (ל-UI).

> **DRY**: ה-logic ב-`retryTranscribe` כמעט זהה לבלוק ב-`toggle`. שקול לחלץ פרטי
> `#runTranscribe(blob)` משותף. אם זה מסבך — השאר כפילות מינורית, אבל תעד בהערה.

**i18n**: הוסף `mic.retry` = "נסה שוב" (he) / "Try again" (en) + ב-keys.ts.

**UI** (הרכיב שמציג mic.error): כשמוצג `mic.error === "mic.error.transcribe"` **וגם**
`mic.canRetry` — הצג כפתור "נסה שוב" שקורא `mic.retryTranscribe()`. שאר שגיאות ה-mic
(permission/notFound/generic) — בלי כפתור retry (אין blob).

**Verification**:
```bash
pnpm typecheck
pnpm lint:i18n
pnpm --filter @drive-coding/frontend-v2 test
# manual: קשה לאוטומציה (מיקרופון). אמת בקריאת קוד שה-blob נשמר ב-catch ולא נזרק,
# ו-retryTranscribe משתמש בו. אופציונלי: mock transcribe שזורק → ודא כפתור מופיע.
```

> ⚠️ verifier-phase מומלץ פה (Commit 2) — state machine של ה-mic עדין.

### Commit 3 — AgentSession.listSessions() + state+cache (approach: integration)

**קבצים שמשתנים**:
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts` — **INVASIVE state** (אישור משתמשת)

**מה לעשות** — הוסף state + מתודה שמשתמשת ב-`#client` הקיים (החיבור הפעיל), **בלי spawn**.

הוסף ל-state (בבלוק `// ─── redesign-fix: רשימת סשנים inline ─── (תוספתי)`):
```ts
import type { SessionInfo } from "$lib/adapters/sessions"  // הטיפוס בלבד
// ...
sessions = $state<SessionInfo[]>([])
sessionsLoading = $state<boolean>(false)
sessionsError = $state<string | null>(null)
#sessionsLoaded = false   // True אחרי טעינה מוצלחת אחת — cache; force=true מרענן
```

מתודה ציבורית:
```ts
/**
 * מביא את רשימת הסשנים דרך החיבור ה-ACP הקיים (#client) — ללא spawn של סוכן.
 * cache: טעינה מוצלחת אחת; force=true מרענן. no-op אם אין חיבור פעיל (#client===null)
 * — אז דף החיבור משתמש ב-listSessionsForCwd (spawn) במקום.
 */
listSessions = async (force = false): Promise<void> => {
  if (this.#client === null) return          // אין חיבור — לא טוענים פה
  if (this.sessionsLoading) return
  if (this.#sessionsLoaded && !force) return
  this.sessionsLoading = true
  this.sessionsError = null
  try {
    const res = await this.#client.listSessions()
    const raw = (res as { sessions?: unknown[] }).sessions ?? []
    this.sessions = raw.map(normalizeSessionInfo)
    this.#sessionsLoaded = true
  } catch (e) {
    // -32601 = ה-CLI לא תומך (Gemini) → רשימה ריקה, לא שגיאה
    if ((e as { code?: number }).code === -32601) {
      this.sessions = []
      this.#sessionsLoaded = true
    } else {
      this.sessionsError = e instanceof Error ? e.message : String(e)
    }
  } finally {
    this.sessionsLoading = false
  }
}
```

**`normalizeSessionInfo`** — ה-normalize שמופיע ב-`sessions.ts:76` (`normalizeSession`) הוא
פרטי שם. אפשרויות:
- (א) ייצא אותו מ-`sessions.ts` (`export function normalizeSessionInfo`) ויבא ב-agent-session.
- (ב) שכפל פונקציה פרטית קטנה ב-agent-session.

**העדף (א)** — ייצוא משותף (DRY, מקור-אמת אחד לצורת ה-SessionInfo). שנה ב-sessions.ts:
`function normalizeSession` → `export function normalizeSessionInfo` ועדכן את הקריאה
הפנימית שם (`raw.map(normalizeSession)` → `raw.map(normalizeSessionInfo)`).

> נקה את ה-cache ב-detach: בתוך `detach()` (שורה ~150) הוסף `this.sessions = []`,
> `this.#sessionsLoaded = false`, `this.sessionsError = null` — סשן חדש = רשימה טרייה.

**Verification**:
```bash
pnpm typecheck
pnpm --filter @drive-coding/frontend-v2 test   # agent-session tests עדיין ירוקים
```

### Commit 4 — SessionOptionsPanel: סשנים inline + מחיקת SessionsDialog (approach: manual)

**קבצים שמשתנים**:
- `packages/frontend/src/lib/components/layout/SessionOptionsPanel.svelte`
- `packages/frontend/src/lib/components/layout/AppShell.svelte` — הסר `<SessionsDialog />` + import
- `packages/frontend/src/lib/view-models/modals.svelte.ts` — הסר `sessionsOpen` + `openSessions`/`closeSessions`
- `packages/frontend/src/routes/+page.svelte` — אם משתמש ב-`modals.openSessions` — בדוק (כנראה לא).

**קבצים שנמחקים**:
- `packages/frontend/src/lib/components/modals/SessionsDialog.svelte` — DELETE

**מה לעשות ב-SessionOptionsPanel** (החלף את בלוק הסשנים, שורות ~272-274 — ה-placeholder
הריק `<!-- רשימה מלאה ב-SessionsDialog -->` בשורה 274):
- כפתור הרענון (שורה ~257, היום `onclick={() => modals.openSessions()}`) → `onclick={() => session.listSessions(true)}`.
- כפתור "סשן חדש" (שורה ~267, היום `modals.openSessions()`) → קורא `onNewSession()` שעושה
  `session.detach()` + `goto("/")` (חזרה לדף החיבור ליצירת סשן חדש). **אמת** את ההתנהגות
  הרצויה — סשן חדש מצריך cwd/cliKind שנבחרים בדף החיבור.
- במקום ה-placeholder הריק — רשימת `SessionCard` לכל `session.sessions`:
  ```svelte
  {#if session.sessionsLoading}
    <div class="text-[12px] opacity-50 px-1">{t("modal.sessions.loading")}</div>
  {:else if session.sessionsError}
    <div class="text-[12px] px-1" style="color:var(--recording)">{t("modal.sessions.error")}: {session.sessionsError}</div>
  {:else}
    {#each session.sessions as s (s.sessionId)}
      <SessionCard session={s} isActive={false} onSelect={() => selectSession(s)} />
    {/each}
  {/if}
  ```
- `selectSession(info)`: `session.detach()` + `await session.loadSession({ sessionId, cwd, cliKind })`
  + `goto("/chat")` + `uiShell.closeSheet()`. **חיקוי** של מה ש-SessionsDialog עשה (selectSession
  שם, שורות 50-58). cliKind מ-`settings.cliKind` (getSettings).
- **טעינה אוטומטית** (טריגר מדויק — finding 4 של אביגיל):
  - **דסקטופ** (`!responsive.isMobile`): ה-sidebar תמיד גלוי → טוען מיד. ה-sheet **לעולם לא נפתח**
    בדסקטופ, אז אסור להסתמך על `sheetOpen` שם.
  - **מובייל** (`responsive.isMobile`): טוען כש-`uiShell.sheetOpen === true` (המשתמש פתח את ה-sheet).
  - מימוש מומלץ — `$effect` שקורא **את שני** ה-state הריאקטיביים כטריגר, וטוען לפי התנאי:
    ```ts
    $effect(() => {
      const shouldLoad = responsive.isMobile ? uiShell.sheetOpen : true
      if (!shouldLoad) return
      // untrack: listSessions כותב sessionsLoading/Error ($state) — בלי untrack ה-effect
      // יגיב לכתיבות ויירוץ שוב (gotcha). idempotent+cache מונע כפילות בכל מקרה.
      untrack(() => void session.listSessions())
    })
    ```
  > ה-effect מגיב ל-`responsive.isMobile` + `uiShell.sheetOpen` (טריגרים), **לא** ל-sessionsLoading/Error
  > (אלה ב-untrack). **אין סיכון DDoS** — listSessions idempotent (`#sessionsLoaded` guard).
  > ראה memory ($effect retry loop) + VoicePicker.svelte לדפוס ה-untrack.

**imports חדשים ל-SessionOptionsPanel**: `SessionCard` מ-`$lib/components/modals/SessionCard.svelte`,
`getSettings`, `untrack` מ-svelte. הסר את `getModals`/`modals` אם לא נשאר בו שימוש (בדוק).

**מחיקת SessionsDialog**:
- AppShell.svelte: הסר את שורת `<SessionsDialog />` + ה-import שלו.
- modals.svelte.ts: הסר `sessionsOpen`, `openSessions()`, `closeSessions()`. **השאר** את
  `folderOpen`/`openFolder`/`closeFolder` (FolderPicker עדיין בשימוש — C10 + Settings).
- מחק את הקובץ `SessionsDialog.svelte`.
- ודא: `grep -rn "SessionsDialog\|openSessions\|sessionsOpen\|closeSessions" packages/frontend/src`
  → 0 תוצאות אחרי המחיקה.

> **i18n**: המפתחות `modal.sessions.*` (loading/error/empty/refresh/new/title) — חלקם עדיין
> בשימוש inline (loading/error). אל תמחק מפתחות i18n שעדיין בשימוש. אם `modal.sessions.title`
> נשאר יתום אחרי מחיקת ה-Dialog — אפשר להשאיר (לא חוסם), או למחוק אם 0 שימושים.

**Verification**:
```bash
pnpm typecheck
pnpm lint:i18n
pnpm --filter @drive-coding/frontend-v2 build
# manual: BE+OneCLI על 4011, התחבר לסשן אמיתי, פתח sidebar/sheet → רשימת סשנים נטענת
# (דרך החיבור, לא spawn — ודא בלוג BE שאין createAgent חדש לרשימה). רענון עובד.
# בחירת סשן אחר → detach+loadSession+ניווט. ודא 0 references ל-SessionsDialog.
```

> verifier (calev light) מאמת את Commit 4 בריצה אמיתית — זו הנקודה עם data-flow אמיתי.

---

## §5 — DoD verifiable

| # | בדיקה | איך |
|---|------|------|
| 1 | typecheck נקי | `pnpm --filter @drive-coding/frontend-v2 typecheck` + `pnpm --filter @drive-coding/core build` |
| 2 | build נקי | `pnpm --filter @drive-coding/frontend-v2 build` |
| 3 | כל הטסטים עוברים | `pnpm test` |
| 4 | lint:i18n נקי | `pnpm lint:i18n` |
| 5 | with-retry: backoff + cap + exhaust + abort | `pnpm --filter @drive-coding/core test -- with-retry` — כל 6 הטסטים |
| 6 | transcribe timeout=30000 | קריאת קוד: `TRANSCRIBE_TIMEOUT_MS === 30000` |
| 7 | transcribe עטוף ב-withRetry | קריאת קוד: `withRetry(() => withTimeout(...))`, signal עובר לשתי השכבות |
| 8 | Mic שומר blob בכשל | קריאת קוד: ב-catch של transcribe, `#lastBlob` **לא** מתאפס; בהצלחה כן |
| 9 | retryTranscribe + canRetry | קריאת קוד: מתודה ציבורית קיימת, משתמשת ב-#lastBlob, getter canRetry |
| 10 | כפתור "נסה שוב" ב-UI | mock transcribe שזורק → DOM מציג כפתור "נסה שוב" כש-error===transcribe |
| 11 | AgentSession.listSessions דרך #client | קריאת קוד: משתמש ב-`this.#client.listSessions()`, **לא** createAgent; no-op אם #client===null |
| 12 | listSessions cache + force | קריאת קוד: `#sessionsLoaded` guard; force=true עוקף |
| 13 | detach מנקה sessions cache | קריאת קוד: detach() מאפס sessions+#sessionsLoaded |
| 14 | סשנים inline ב-panel | manual: BE חי, התחבר, פתח sheet/sidebar → רשימה נטענת **בלי** createAgent בלוג BE |
| 15 | בחירת סשן = detach+load | manual: לחץ סשן אחר → detach+loadSession+ניווט /chat |
| 16 | SessionsDialog נמחק לגמרי | `grep -rn "SessionsDialog\|openSessions\|sessionsOpen" packages/frontend/src` → 0 |
| 17 | FolderPicker עדיין עובד | regression: modals.folderOpen נשאר; דף החיבור + Settings פותחים תיקייה |
| 18 | regression: redesign UI | mobile+desktop screenshot — שורת פעולות עליונה (השתק/נתק/⚙) + סוכן/מודל חצאים עדיין נכונים |

---

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|------|------|----------|
| Hardcoded Hebrew | learnings | מפתח `mic.retry` בלבד דרך i18n. `pnpm lint:i18n` |
| **$effect retry loop** (DDoS) | memory 2026-05-16 + 2026-06-02 | `listSessions` ב-$effect של panel חייב `untrack` + cache guard. ה-retry האמיתי לא ב-$effect. DoD#11/#12 |
| **$effect קורא+כותב state** | memory | `untrack(() => void session.listSessions())`. ה-effect מגיב ל-uiShell.sheetOpen בלבד |
| transcribe signal לא עובר ל-2 השכבות | חדש | DoD#7: signal ל-withRetry **וגם** withTimeout. abort → לא retry |
| INVASIVE state ב-2 VMs | AGENTS.md | אושר ע"י משתמשת (Mic + AgentSession). תוספתי בלבד — שדות+מתודות, לא שינוי state קיים |
| מחיקת modals.sessionsOpen שוברת caller | חדש | grep לפני מחיקה (DoD#16). השאר folderOpen |
| בחירת סשן בזמן סשן פעיל — race | חדש | detach לפני loadSession (כמו SessionsDialog הקיים). loadSession זורק אם status connecting/connected — detach קודם מחזיר ל-idle |
| spawn fallback נשבר | חדש | **לא נוגעים** ב-listSessionsForCwd. רק מייצאים את normalizeSession. דף החיבור עובד כרגיל. DoD#17 |
| flash-latest עדיין איטי (5-10s) | סקר תשתית 2026-06-02 | timeout 30s נותן מרווח; retry מטפל בכשל. לא משנים מודל (החלטת משתמשת) |

> 3 שתמיד נשכחים:
> 1. Hardcoded strings → i18n (`mic.retry`)
> 2. Svelte 5 reactivity — `untrack` ב-$effect של listSessions, `{#each ... (s.sessionId)}`
> 3. OneCLI — transcribe דרך /proxy/google → BE חייב OneCLI

---

## §7 — Escalation triggers

עצור ושאל את מרדכי אם:
- `AcpClient.listSessions()` לא מחזיר את הצורה הצפויה (`{ sessions: [...] }`) — אז ה-normalize שגוי.
- בחירת סשן בזמן סשן פעיל גורמת ל-WS-close error / race שלא נפתר ע"י detach-קודם.
- ה-$effect של listSessions עושה לולאה למרות untrack (DDoS) — עצור, אל "תתקן" ב-throttle.
- מתברר שצריך לשנות state **קיים** ב-Mic/AgentSession (לא רק להוסיף) — INVASIVE מעבר למוסכם.
- מחיקת SessionsDialog שוברת זרימה לא-צפויה (caller נסתר).
- ה-`with-retry` מתנגש עם `with-timeout` (signal kicked twice / double-abort).

---

## §8 — Complexity score + verifier tier

| פרמטר | ניקוד |
|------|------|
| Cross-store data flow חדש (listSessions VM→panel) | +2 |
| State machine / async coordination (retry + mic state) | +2 |
| INVASIVE state ב-2 VMs | +1 |
| >5 files ב->1 package (core + frontend) | +1 |
| Refactor (מחיקת SessionsDialog + reroute) | +1 |
| ספרייה חדשה? לא | 0 |
| TDD על Commit 0+1 | -1 |
| דפוס קיים לחיקוי (with-timeout, VoicePicker untrack, SessionsDialog selectSession) | -1 |

**Score**: 6 / 10

**Tier**: `calev` mode: light + **verifier-phase על Commit 2 ו-Commit 4**.
- Commit 2 (mic state machine — blob lifecycle עדין)
- Commit 4 (data-flow אמיתי + מחיקת קומפוננטה — regression risk)

**Verifier-phase**: Commit 2, Commit 4.

---

## §9 — שאלות פתוחות

| # | שאלה | הכרעה | חוסם? |
|---|------|----------|------|
| 1 | base — dev או שרשור? | **dev** (`266322f`) — הכל מוזג (סוכן אחר השלים merge ל-dev) | ❌ |
| 2 | retry values (3 נסיונות, base 800ms, max 4s) סבירים לתמלול? | כן — תמלול איטי, 3 נסיונות עם backoff קצר. לא חוסם, executor יכול לכוונן בגבול | ❌ |
| 3 | "סשן חדש" ב-panel — detach+goto("/") או dialog? | detach+goto("/") — צריך cwd/cliKind מדף החיבור. executor יאמת UX | ❌ |
| 4 | טעינת סשנים אוטומטית — טריגר בדסקטופ vs מובייל? | **דסקטופ**: מיד (sidebar גלוי). **מובייל**: כש-sheetOpen. $effect קורא `responsive.isMobile`+`sheetOpen`, untrack על listSessions. (תוקן ע"י אביגיל finding 4) | ❌ |
| 5 | normalizeSession — ייצוא או שכפול? | ייצוא מ-sessions.ts (DRY). executor יעדכן את הקריאה הפנימית | ❌ |
| 6 | החלפת מודל תמלול | **לא** (החלטת משתמשת) — נשארים flash-latest | ❌ |

---

## סטיות מהתכנון (מתעדכן ע"י executor תוך כדי)

- **טסט transcribe.test.ts**: שיניתי את הטסט הקיים (שבדק TIMEOUT=15000) לטסטים חדשים שמשקפים את המצב החדש (30000 + withRetry). הטסטים עדיין mockים גם withTimeout וגם withRetry (brief אמר שאפשר למקק withRetry/withTimeout). הלוגיקה נבדקת ב-core tests.
- **#runTranscribe חולץ**: חילצתי #runTranscribe() פרטי ב-Mic (DRY: toggle+retryTranscribe). ה-brief הציע זאת ("שקול לחלץ") — אימצתי.
- **calev light**: GO 17/17. finding יחיד: 2 שגיאות TS קדם-קיימות ב-narrate.test.ts (לא שלנו).
