# Slice review-fixes-2 — timeout בכל ה-FE adapters (withTimeout) — תוכנית

> **תאריך**: 2026-06-02
> **סטטוס**: הושלם (אליעזר, 2026-06-02 — calev GO 13/13)
> **Complexity**: 4/10 (verifier: light)
> **תלויות (`depends_on`)**: [slice-review-fixes-1] — צריך את `withTimeout` helper
> **Base**: branch `slice-review-fixes-1` (tip `2a551d4`) — **לא dev**, כי ה-helper עוד לא merged
> **Dev tip**: `bd691ea`

---

## §0 — Pre-flight

### תלויות (חובה!)

slice זה **מבוסס על**:
- **slice-review-fixes-1** (status: verified, calev GO, **לא merged**) — מוסיף את
  `withTimeout` helper ב-`@drive-coding/core/async/with-timeout`. כל ה-slice הזה נשען עליו.

> כיוון ש-review-fixes-1 עוד לא merged ל-dev, ה-base של slice זה הוא **branch
> `slice-review-fixes-1`** (שרשור). merge בסוף: review-fixes-1 → dev, ואז review-fixes-2 → dev.
> `depends_on: [slice-review-fixes-1]`.

### Worktree

```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/slice-review-fixes-2 -b slice-review-fixes-2 slice-review-fixes-1
cd .worktrees/slice-review-fixes-2
pnpm install && pnpm hooks:install
pnpm --filter @drive-coding/frontend exec svelte-kit sync   # worktree טרי
```

> שים לב: `-b slice-review-fixes-2 slice-review-fixes-1` — ה-base הוא branch התלות,
> לא dev. ודא ש-`withTimeout` קיים: `ls packages/core/src/async/with-timeout.ts`.

### איך להריץ

- Tests: `pnpm test` מה-root (כולל core). FE בלבד: `pnpm --filter @drive-coding/frontend test`
- typecheck: `pnpm typecheck` (אם `TS6305 core/dist` — `rm -f packages/*/tsconfig.tsbuildinfo` ושוב)
- build: `pnpm --filter @drive-coding/frontend build`
- lint:i18n: `pnpm lint:i18n`

> אין צורך ב-BE/OneCLI/tunnel — כל הטסטים עם mock.

### Browser

לא נדרש.

### Reading list

**must-read**:
- `packages/core/src/async/with-timeout.ts` — ה-helper (מ-review-fixes-1). למד את החתימה `withTimeout(fn, ms, opts?)`.
- `packages/frontend/src/lib/adapters/voice/transcribe.ts` — דוגמה לשימוש ב-withTimeout (מ-review-fixes-1) — **דפוס לחיקוי**.
- `packages/frontend/AGENTS.md` — חוקי השכבות.

**reference**:
- `docs/investigations/2026-06-01-full-code-review.md` §F4 (463), §F7 (468).

---

## §1 — מטרה

אחרי slice review-fixes-1 יש לנו `withTimeout`. עכשיו מחילים אותו על **כל** קריאות
ה-I/O ב-FE adapters שחסר להן timeout, כך שאף קריאה ל-BE/proxy לא יכולה להיתקע לנצח
אם השרת תלוי. אחרי ה-slice: יצירת agent, טעינת קולות, TTS, וקריאות agent-api אחרות —
כולן נכשלות אחרי timeout במקום להיתקע.

> **לא נוגעים ב-BE proxy streaming** (`http-proxy.ts`) — timeout על stream הוא בעיה
> שונה (connect-vs-stream) ששמורה לסבב נפרד. כאן רק FE adapters.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|------|------|------|
| `agents-api.ts`: `createAgent` timeout | ✅ | Commit 1 |
| `agents-api.ts`: `notifySessionAttached` timeout | ✅ | Commit 1 |
| `agents-api.ts`: `deleteAgent` timeout | ✅ | Commit 1 |
| `voices.ts`: `listVoices` timeout (F7) | ✅ | Commit 2 |
| `tts.ts`: `synthesizeStreaming` connect-timeout (F7) | ✅ | Commit 2 |
| `narrate.ts`: יישור timeout ידני → withTimeout | ✅ | Commit 3 |
| `getAgent`: timeout/F4 fix | ❌ | **לא לגעת** — רק הערת TODO (אין צרכן, מחוץ ל-scope) |
| BE proxy `http-proxy.ts` streaming timeout | ❌ | סבב נפרד (connect-vs-stream) |
| F1/F2/F9 ושאר FE | ❌ | סבבים אחרים |

> **getAgent**: ה-brief **לא משנה אותו**. רק מוסיף הערה (ראה Commit 1).

---

## §3 — Architecture diagram

```
withTimeout (קיים מ-review-fixes-1, ב-core)
        │
        ├─→ Commit 1: agents-api.ts
        │     createAgent(input, signal?)      ← מוסיף param signal אופציונלי
        │     notifySessionAttached(...)        ← fire-and-forget, timeout פנימי
        │     deleteAgent(agentId)              ← fire-and-forget, timeout פנימי
        │     getAgent  ← לא נגעים. רק // TODO: "בדוק אם מישהו משתמש"
        │
        ├─→ Commit 2: voices.ts + tts.ts
        │     listVoices(signal?)               ← עוטף fetch ב-withTimeout
        │     synthesizeStreaming(opts)         ← עוטף את ה-fetch (connect) בלבד,
        │                                          ה-stream (response.body) מוחזר אחרי
        │                                          ה-timeout — לא נקטע
        │
        └─→ Commit 3: narrate.ts
              מחליף AbortController+setTimeout ידני (3000ms) ב-withTimeout

callers (לא משתנים מהותית, אבל חלקם יקבלו timeout "בחינם"):
  settings.loadVoices  → listVoices()  (כיום בלי signal — יקבל timeout פנימי)
  speaker → synthesizeStreaming({ signal: job.abort.signal })  (signal נשמר + timeout)
  agent-session → createAgent(...)  (101/206, בלי signal — timeout פנימי)
  sessions.ts:42 → createAgent(...)  (caller שלישי, בלי signal — timeout פנימי)
```

---

## §4 — Commits בסדר

### Commit 1 — agents-api.ts: timeout ב-createAgent/notifySessionAttached/deleteAgent (approach: tdd)

**קבצים שמשתנים**:
- `packages/frontend/src/lib/adapters/agents-api.ts`

**קבצים חדשים**:
- `packages/frontend/src/lib/adapters/agents-api.test.ts`

**מה לעשות** — עטוף כל אחת מ-3 הפונקציות ב-`withTimeout`. ה-fetch קצר (JSON, לא stream),
אז timeout פשוט. קבוע משותף:

```ts
import { withTimeout } from "@drive-coding/core/async/with-timeout"

const AGENTS_API_TIMEOUT_MS = 10000  // קריאות API קצרות; BE מקומי בדר"כ < 1s
```

**`createAgent`** — הוסף param `signal?: AbortSignal` (additive, ברירת מחדל undefined):
```ts
export async function createAgent(
  input: CreateAgentInput,
  signal?: AbortSignal,
): Promise<CreateAgentResponse> {
  const res = await withTimeout(
    (s) => fetch(beUrl("/api/agents"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: s,
    }),
    AGENTS_API_TIMEOUT_MS,
    { signal, label: "createAgent" },
  )
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`createAgent failed: ${res.status} ${body}`)
  }
  return (await res.json()) as CreateAgentResponse
}
```

**`notifySessionAttached`** ו-**`deleteAgent`** — אותו דפוס. הם fire-and-forget אצל
הקוראים (`.catch(() => {})`), אבל ה-timeout עדיין חשוב (מונע fetch תלוי שדולף).
שמור על החתימות הקיימות (אין צורך להוסיף signal — הם לא מקבלים אחד מהקורא; פשוט
timeout פנימי בלי external signal):
```ts
export async function deleteAgent(agentId: string): Promise<void> {
  const res = await withTimeout(
    (s) => fetch(beUrl(`/api/agents/${agentId}`), { method: "DELETE", signal: s }),
    AGENTS_API_TIMEOUT_MS,
    { label: "deleteAgent" },
  )
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`deleteAgent failed: ${res.status} ${body}`)
  }
}
```
(`notifySessionAttached` דומה — fetch POST עטוף, בלי בדיקת res.ok כי הוא void/fire-and-forget כיום. שמור על ההתנהגות.)

**`getAgent`** — **אל תיגע בקוד.** רק הוסף הערה מעל הפונקציה:
```ts
// TODO(review-fixes-2): getAgent — אין צרכן בקוד כרגע (grep ב-2026-06-02). לבדוק אם
// מישהו משתמש בזה לפני שמשקיעים בו timeout/error-handling (F4). אם dead — למחוק בסבב נפרד.
```

**טסט**: `agents-api.test.ts` — `vi.stubGlobal("fetch", ...)` או mock. כסה:
- createAgent happy: fetch מחזיר `{ ok: true, json: () => ({ agentId: "a1" }) }` → מחזיר `{ agentId: "a1" }`.
- createAgent timeout: fetch תלוי לנצח (`new Promise(()=>{})`) + advance ל-10000 → דוחה.
- deleteAgent happy + timeout (אותו דפוס).

> כיוון ש-`withTimeout` אמיתי משתמש ב-fake timers שגרמו ל-warnings ב-review-fixes-1 —
> אם נתקלים באותה בעיה, mock את `withTimeout` (כמו ב-transcribe.test.ts מ-review-fixes-1)
> ובדוק רק שה-fetch נקרא נכון; לוגיקת ה-timeout מכוסה ב-with-timeout.test.ts.

**Verification**:
```bash
pnpm test
pnpm typecheck
```

### Commit 2 — voices.ts + tts.ts: timeout (F7) (approach: tdd)

**קבצים שמשתנים**:
- `packages/frontend/src/lib/adapters/voice/voices.ts`
- `packages/frontend/src/lib/adapters/voice/tts.ts`

**`listVoices`** — כבר מקבל `signal?`. עטוף את ה-fetch:
```ts
const VOICES_TIMEOUT_MS = 8000

export async function listVoices(signal?: AbortSignal): Promise<Voice[]> {
  const res = await withTimeout(
    (s) => fetch(beUrl("/proxy/elevenlabs/v1/voices"), {
      method: "GET",
      headers: { "xi-api-key": "browser-placeholder", accept: "application/json" },
      signal: s,
    }),
    VOICES_TIMEOUT_MS,
    { signal, label: "listVoices" },
  )
  // ... שאר הקוד (res.ok check + json) ללא שינוי ...
}
```

**`synthesizeStreaming`** — ⚠️ **קריטי: עטוף רק את ה-fetch (connect), לא את צריכת ה-stream.**
ה-`await fetch(...)` נפתר ברגע שה-headers חוזרים (לפני צריכת `response.body`). לכן
withTimeout על ה-fetch מטפל ב-connect/first-response בלבד — ה-stream שמוחזר נצרך
**אחרי** ש-withTimeout הסתיים, ולא מושפע מה-timeout:
```ts
const TTS_CONNECT_TIMEOUT_MS = 10000

export async function synthesizeStreaming(opts: TtsOptions): Promise<ReadableStream<Uint8Array>> {
  const modelId = opts.modelId ?? "eleven_v3"
  const response = await withTimeout(
    (s) => fetch(beUrl(`/proxy/elevenlabs/v1/text-to-speech/${opts.voiceId}/stream`), {
      method: "POST",
      headers: { /* ... ללא שינוי ... */ },
      body: JSON.stringify({ /* ... ללא שינוי ... */ }),
      signal: s,
    }),
    TTS_CONNECT_TIMEOUT_MS,
    { signal: opts.signal, label: "tts-connect" },
  )
  if (!response.ok) { /* ... ללא שינוי ... */ }
  if (!response.body) { /* ... ללא שינוי ... */ }
  return response.body   // ← ה-stream נצרך אחרי, לא מושפע מה-timeout
}
```

> **למה זה בטוח** (תעד): ה-timeout עוטף רק את `fetch` (פתיחת חיבור + קבלת headers).
> ברגע ש-`response` חוזר, withTimeout הסתיים והטיימר נוקה (clearTimeout ב-finally).
> ה-`response.body` (ReadableStream) מוחזר ונצרך ע"י ה-caller (Speaker→AudioStream)
> מאוחר יותר — מחוץ ל-scope של ה-timeout. הזרמת אודיו ארוכה לא תיקטע. ✓
> ⚠️ **אזהרה**: ה-`ac.abort()` של ה-timeout, אם יורה, מבטל את ה-fetch. אבל אם ה-fetch
> כבר נפתר (headers הגיעו) — clearTimeout כבר רץ והטיימר לא יורה. אין race.

**טסט**: עדכן/צור `voices.test.ts` + `tts.test.ts` (או הרחב קיימים). mock fetch.
- listVoices happy + timeout.
- tts: fetch מחזיר response עם body stream → מחזיר את ה-stream. timeout: fetch תלוי → דוחה.
- (mock withTimeout אם fake-timers בעייתי, כמו Commit 1.)

**Verification**:
```bash
pnpm test
pnpm typecheck
```

### Commit 3 — narrate.ts: יישור ל-withTimeout (approach: tdd)

**קבצים שמשתנים**:
- `packages/frontend/src/lib/adapters/voice/narrate.ts`

החלף את הבלוק הידני (AbortController + setTimeout + try/catch/finally, שורות 32-51 —
מ-`const ac = new AbortController()` עד ה-`}` של ה-finally) בקריאה ל-`withTimeout`,
**תוך שמירה על ההתנהגות**: narrate מחזיר `null` בשגיאה/timeout
(הקורא מתייחס ל-null כ"דלג על קריינות"). שמור על `TIMEOUT_MS = 3000`:
```ts
import { withTimeout } from "@drive-coding/core/async/with-timeout"
// TIMEOUT_MS = 3000 נשאר

try {
  const result = await withTimeout(
    (s) => generateText({
      model: googleAi("gemini-flash-lite-latest"),
      prompt,
      abortSignal: s,
    }),
    TIMEOUT_MS,
    { signal, label: "narrate" },
  )
  const text = result.text.trim()
  if (text.length === 0) return null
  return text
} catch (e) {
  console.warn("narrate failed", { err: e instanceof Error ? e.message : String(e) })
  return null
}
```

> **שמות**: narrate מקבל `signal?` (פרמטר חיצוני בשם `signal`, לא `opts.signal`).
> `googleAi` + `generateText` (לא generateContent). ה-`ai` SDK מכבד abortSignal.

**טסט**: `narrate.test.ts` קיים? אם כן — ודא שעדיין ירוק (התנהגות זהה: null בשגיאה).
אם לא — מומלץ טסט timeout→null אחד (אופציונלי, regression מכוסה ע"י typecheck+התנהגות שמורה).

**Verification**:
```bash
pnpm test
pnpm typecheck
```

---

## §5 — DoD verifiable

| # | בדיקה | איך |
|---|------|------|
| 1 | typecheck נקי | `pnpm typecheck` |
| 2 | build נקי | `pnpm --filter @drive-coding/frontend build` |
| 3 | כל הטסטים עוברים | `pnpm test` |
| 4 | lint:i18n נקי | `pnpm lint:i18n` |
| 5 | createAgent timeout | קריאת קוד: `createAgent` עוטף `withTimeout`, param signal נוסף |
| 6 | deleteAgent + notifySessionAttached timeout | קריאת קוד: שניהם עוטפים withTimeout |
| 7 | getAgent **לא שונה** + יש TODO | git diff: getAgent body זהה ל-base; יש הערת TODO מעליו |
| 8 | listVoices timeout | קריאת קוד: עוטף withTimeout |
| 9 | tts connect-timeout בלבד | קריאת קוד: withTimeout עוטף את ה-fetch, `return response.body` **מחוץ** ל-withTimeout |
| 10 | narrate מיושר | קריאת קוד: withTimeout במקום AbortController ידני; עדיין מחזיר null |
| 11 | regression: Speaker TTS | `pnpm test` — speaker tests ירוקים; tts עדיין מקבל signal מ-job.abort |
| 12 | regression: loadVoices | `pnpm test` — settings.loadVoices tests (idempotency/parallel) ירוקים |
| 13 | regression: createAgent callers | `pnpm test` — agent-session tests (createAgent ב-101/206) **וגם** sessions.ts:42 ירוקים. ה-signal האופציונלי additive → כל 3 הקוראים עובדים בלי שינוי |

---

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|------|------|----------|
| Hardcoded Hebrew | learnings | אין מחרוזות חדשות (הודעות שגיאה קיימות). `pnpm lint:i18n` |
| **tts timeout קוטע streaming** | חדש (קריטי) | withTimeout עוטף **רק** את ה-fetch (connect). `return response.body` מחוץ ל-withTimeout. DoD#9 מאמת בקריאת קוד. אם executor בספק — ה-stream חייב להיות מוחזר **אחרי** שה-withTimeout resolve |
| שינוי חתימה שובר caller | חדש | `createAgent` מקבל signal **אופציונלי** (additive). שאר החתימות לא משתנות. callers לא צריכים שינוי. DoD#11/#12/#13 |
| narrate משנה התנהגות | חדש | חייב להמשיך להחזיר null. try/catch סביב withTimeout שומר. DoD#10 |
| fake-timers warnings | review-fixes-1 | אם הטסטים נתקלים ב-PromiseRejectionHandledWarning — mock את withTimeout (כמו transcribe.test.ts), הלוגיקה מכוסה ב-with-timeout.test.ts |
| getAgent — נגיעה לא מכוונת | החלטת משתמשת | **רק** הערת TODO. אסור לשנות body, אסור לתקן F4. DoD#7 (git diff) |
| base שגוי (dev במקום branch התלות) | שרשור | ה-worktree base = `slice-review-fixes-1`. ודא `with-timeout.ts` קיים אחרי checkout |

---

## §7 — Escalation triggers

עצור ושאל את מרדכי אם:
- מתברר שה-`await fetch` ב-tts **כן** מחכה לגוף לפני resolve (לא צפוי — fetch resolve על headers) → אז עטיפת withTimeout היתה קוטעת streaming, וצריך גישה אחרת.
- צריך לשנות חתימה של פונקציה מעבר ל-signal אופציונלי ב-createAgent.
- ה-base branch `slice-review-fixes-1` לא קיים / `with-timeout.ts` חסר.
- narrate/voices callers שוברים בגלל שינוי התנהגות לא צפוי.

---

## §8 — Complexity score + verifier tier

| פרמטר | ניקוד |
|------|------|
| Refactor של קוד קיים (6 פונקציות ב-3 adapters) | +1 |
| >5 files? (3 adapters + טסטים) | +1 |
| Streaming/real-time (tts — אבל רק connect, לא הזרמה עצמה) | +1 |
| תלוי ב-slice קודם לא-merged (שרשור) | +1 |
| Pure-ish, IO wrapping בלבד | 0 |
| TDD | -1 |
| דפוס קיים לחיקוי (transcribe מ-review-fixes-1) | -1 |

**Score**: 4 / 10

**Tier**: `calev` mode: light. שקול verifier-phase על Commit 2 (tts — ה-streaming-safety הוא הנקודה העדינה).

**Verifier-phase**: Commit 2 (tts connect-timeout — לוודא שה-stream לא נקטע).

---

## §9 — שאלות פתוחות

| # | שאלה | הכרעה | חוסם? |
|---|------|----------|------|
| 1 | timeout values סבירים? (createAgent 10s, voices 8s, tts-connect 10s, narrate 3s) | כן — קריאות API/connect קצרות; narrate נשאר כמו שהיה (3s) | ❌ |
| 2 | getAgent — למחוק/לתקן? | **לא בסבב הזה** (החלטת משתמשת) — רק הערת TODO. אין צרכן בקוד | ❌ |
| 3 | notifySessionAttached/deleteAgent צריכים signal חיצוני? | לא — הם fire-and-forget; timeout פנימי מספיק | ❌ |

---

## סטיות מהתכנון (מתעדכן ע"י executor תוך כדי)

- אין סטיות. כל 3 commits בוצעו לפי הbrief. withTimeout mocked בכל טסטי adapters (כמו transcribe.test.ts).
