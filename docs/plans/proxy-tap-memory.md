# Slice — proxy-tap-memory — תוכנית

> **תאריך**: 2026-07-04
> **סטטוס**: הושלם (אליעזר, 2026-07-04 — 4 commits; calev-heavy רץ)
> **Complexity**: 6/10 (verifier: **heavy** — ראה §8, אימות-זיכרון-תחת-עומס)
> **תלות**: אין (`depends_on: []`, base=dev)

---

## רקע — הנפילה שהוליד את הסבב (חובה קריאה)

ה-BE (‏bun, pid 29680) **קרס** בזמן proxy ל-Gemini TTS. אבחנה חיה (‏2026-07-03/04):
- ‏התהליך **מת** (‏`tasklist` ריק) — crash אמיתי, לא hang.
- ‏**אין** `uncaughtException — exiting` בלוג → לא עבר דרך ה-JS handler ב-`server.ts` → זה crash ברמת ה-runtime (‏OOM / native), שהורג מיד.
- ‏קרה בתוך נתיב ה-Gemini TTS proxy (`streamGenerateContent`).

**השורש — מאומת ב-repro חי** (‏`bun`, מכונת-הפיתוח):
ה-commit `76bb8b7` (‏slice `tts-usage-metering`, **ב-dev**) הוסיף בנתיב Gemini
`res.body.tee()` + `readStreamInBackground` (‏full-buffer). שני repro-ים הוכיחו:

| גישה | ‏RSS ל-stream ~256MB | מסקנה |
|---|---|---|
| ‏`tee()` (‏היום), ה-tap קורא בלי-לצבור, client לא-נצרך | ‏67 → **326MB** | ‏ה-`tee` של Bun **לא** מפעיל backpressure — מבפר את ה-branch הלא-נצרך במלואו |
| ‏`TransformStream` peek, client איטי | ‏67 → **86MB** יציב | ‏`produced≈clientRead` — client-paced, buffer קבוע ~2 chunks |

**המשמעות**: כל בקשת Gemini-TTS שבה ה-FE איטי/מנותק מבפרת את כל ה-audio בזיכרון.
**פלייליסט = כל היסטוריית השיחה** → בקשות מרובות → הצטברות → OOM → ה-BE נופל
**עם כל הסוכנים ה-in-process שתלויים בו** (‏claude רץ Model-2 in-process).

---

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/proxy-tap-memory -b slice/proxy-tap-memory dev
cd .worktrees/proxy-tap-memory
pnpm install && pnpm hooks:install
```

### Run
- ‏BE: `cd packages/backend && onecli run --agent voice-acp -- bun --watch src/server.ts` (‏port 4000)
  - ‏להרצה מקבילה לצד ה-preview של המשתמשת (‏4002): `PORT=4001 …`
- ‏Tests: `pnpm --filter @drive-coding/core test` · `pnpm --filter @drive-coding/backend test`
- ‏Typecheck: `pnpm typecheck`

### Browser
- ‏אין UI חדש. אימות דרך tests + repro-under-load script (‏§5). Chrome רגיל אם רוצים לראות streaming חי.

### OneCLI agent
- ‏שם: `voice-acp`. שימוש: `onecli run --agent voice-acp -- …` (‏מזריק ElevenLabs + Google keys ל-proxy).
- ⚠️ **מפתח Gemini שרוף כרגע** (‏`403 PERMISSION_DENIED`, פרויקט `generative-code` חסום מנהלית).
  לכן אימות ה-crash-fix **לא** תלוי ב-upstream חי — נעשה עם **mock upstream** (‏§5).

### Reading list
**must-read לפני**:
- ‏`packages/backend/src/delivery/http-proxy.ts` — **שני** ה-`tee()`: הבלוק "Gemini streamGenerateContent"
  (‏tap) והבלוק "פיצול למטמון בהצלחה" (‏cache). שניהם חשופים לאותו OOM.
  > **‏finding אביגיל (‏🟡) — סדר בקובץ הפוך מסדר ה-commits**: ה-**cache** tee מופיע **ראשון**
  > (‏~שורה 181, "פיצול למטמון בהצלחה"), ה-**Gemini tap** tee **שני** (‏~שורה 234). **Commit 1**
  > נוגע ב-**Gemini** (‏השני), **Commit 2** ב-**cache** (‏הראשון). זהה לפי **שם-הבלוק**, לא לפי מספר-שורה
  > (‏מספרי-שורה יזוזו תוך-כדי עריכה).
- ‏`packages/core/src/usage/extract.ts` — `extractGeminiUsage` הקיים (‏עובד על buffer מלא; נעטוף אותו ב-accumulator incremental).
- ‏רקע לעיל (‏ה-repro + האבחנה).

**reference בזמן עבודה**:
- ‏`packages/backend/src/usage/usage-store.ts` — `UsageStore.record()` (‏אל תשנה חתימה).
- ‏`packages/core/src/usage/extract.test.ts` — עוגן ה-TDD להרחבה.

---

## §1 — מטרה

אחרי הסבב: proxy של TTS-streaming **לא יכול להפיל את ה-BE בזיכרון**. הצריכה
הופכת ל-client-paced (‏אין buffering של audio לא-נצרך), ה-usage-metering ממשיך לעבוד
(‏חילוץ `usageMetadata` תוך-כדי-מעבר, zero-retain), ואם ה-RSS הכולל מתקרב לגבול
מסיבה אחרת — ה-BE **מסרב בקשה זמנית (‏503)** במקום ליפול. המשתמש לא רואה הבדל
בשימוש רגיל; תחת עומס-קיצון הוא רואה "busy" במקום קריסה של כל הסוכנים.

---

## §2 — Scope: מה כן, מה לא

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| ‏Gemini tap: `tee`→`TransformStream` peek | ✅ | ‏Commit 0+1 |
| ‏ElevenLabs cache path: `tee`→bounded writer | ✅ | ‏Commit 2 |
| ‏RSS watchdog + 503 degradation | ✅ | ‏Commit 3 (‏גרסה מספקת; refinement עתידי) |
| ‏**disk-cache LRU / size-cap** (‏מטמון הדיסק גדל ללא הגבלה) | ❌ | ‏slice נפרד `proxy-cache-lru` (‏רשום-לטיפול) |
| ‏**בידוד-תהליכי לסוכנים** (‏claude in-process = blast radius) | ❌ | ‏investigation `agent-blast-radius-isolation` |
| ‏**be-shutdown-hardening** (‏פורט שלא-משוחרר, handle-inheritance) | ❌ | ‏brief READY נפרד |
| ‏שינוי ב-`UsageStore` / חוזה FE↔BE | ❌ | ‏אין — proxy הוא dumb-pipe |

---

## §3 — Architecture diagram

```
BE proxy (http-proxy.ts)                         [functional core]
─────────────────────────                        ──────────────────
upstream fetch(res)                               packages/core/usage/
   │                                                gemini-usage-accumulator.ts  ← חדש (Commit 0, TDD)
   ├─ Gemini streamGenerateContent (res.ok):        - push(chunk): stream-decode + line-frame + peek usageMetadata
   │     res.body                                    - result(): GeminiUsage   (zero audio retention)
   │       .pipeThrough(usageTapTransform) ← חדש
   │       → Response(toClient)                     extract.ts (קיים)
   │     (Commit 1 — מחליף tee+readStreamInBackground)  - extractGeminiUsage(line) — נעשה משותף לפריסור-שורה
   │
   ├─ Cacheable (ElevenLabs): res.body
   │     .pipeThrough(cacheTapTransform{cap}) ← חדש  memory-guard.ts (backend/delivery)  ← חדש (Commit 3)
   │     → Response(toClient)                         - overBudget(): boolean   (rss > threshold)
   │     (Commit 2 — מחליף tee+cacheStreamInBackground)
   │
   └─ middleware /proxy/*: guard.overBudget() → 503  (Commit 3)
```

---

## §4 — Commits

### Commit 0 — `createGeminiUsageAccumulator` (approach: **TDD**, core)

**קובץ חדש**: `packages/core/src/usage/gemini-usage-accumulator.ts`
**קובץ טסט חדש**: `packages/core/src/usage/gemini-usage-accumulator.test.ts`

**מה**: accumulator stateful (‏closure) שמקבל chunks גולמיים מזרם SSE ומחלץ את
ה-`usageMetadata` האחרון — **בלי לצבור audio**. מטפל בשני ה-boundary-traps:
1. ‏**line boundary** — chunk נחתך באמצע שורת `data:` → `leftover` string בין push-ים.
2. ‏**utf8 boundary** — תו רב-בייטי נחתך → `TextDecoder({ stream: true })`.

**API skeleton** (‏executor לא משנה חתימה):
```ts
import type { GeminiUsage } from "./extract.js"

export interface GeminiUsageAccumulator {
  /** מזין chunk גולמי מזרם ה-SSE. bounded: מעבד שורות-שלמות, לא צובר audio. */
  push(chunk: Uint8Array): void
  /** ה-usageMetadata האחרון שנראה עד כה, מנורמל ל-GeminiUsage. */
  result(): GeminiUsage
}

export function createGeminiUsageAccumulator(): GeminiUsageAccumulator
```

**מימוש (עקרון)**: `leftover=""`, `decoder=new TextDecoder("utf-8")`, `last: GeminiUsage`.
ב-`push`: `leftover += decoder.decode(chunk, { stream: true })`; `const lines = leftover.split("\n")`;
`leftover = lines.pop() ?? ""` (‏השורה החלקית האחרונה נשמרת); על כל שורה שלמה — אם
מתחילה `data:` → נסה לחלץ usage מה-JSON (‏re-use של הלוגיקה מ-`extractGeminiUsage`).
**קריטי**: לעולם לא לשמור את ה-`inlineData`/audio; שומרים רק את המספרים.

**שיתוף עם `extract.ts`**: לחלץ helper פנימי `parseGeminiChunkUsage(json: unknown): GeminiUsage | undefined`
שגם `extractGeminiUsage` (‏הבצ'י הקיים) וגם ה-accumulator (‏incremental) קוראים לו — DRY,
ומבטיח שהתנהגות ה-incremental זהה לבצ'י. **אל תשבור** את חתימת `extractGeminiUsage` (‏יש לה טסטים).

> **‏finding אביגיל (‏🟡)**: ה-helper מחזיר **`GeminiUsage`** (‏ה-type ה**מיוצא**), כולל הנרמול
> (‏עדיפות `candidatesTokensDetails[modality=AUDIO]` → fallback `candidatesTokenCount`) בתוכו —
> **לא** את ה-`UsageMetadata` הפנימי-הלא-מיוצא (‏שיתופו היה מחייב export של type פנימי מיותר).
> "last non-undefined wins" הן ב-batch והן ב-incremental → תוצאה זהה.

**Verification**:
```bash
pnpm --filter @drive-coding/core test gemini-usage-accumulator
# חייב לכסות: (א) chunk split באמצע שורה, (ב) split באמצע תו-utf8,
# (ג) usageMetadata רק בחלק האחרון, (ד) input עם audio ענק → result נכון וזיכרון לא-צובר
pnpm --filter @drive-coding/core test extract   # רגרסיה — extractGeminiUsage עדיין ירוק
```

### Commit 1 — Gemini tap: `tee` → `TransformStream` peek (approach: **manual + repro**, backend)

**קובץ שמשתנה**: `packages/backend/src/delivery/http-proxy.ts` — הבלוק
"Gemini streamGenerateContent: tee ברקע".

**לפני** (‏להסיר): `const [toClient, toTap] = res.body.tee()` + `readStreamInBackground(toTap).then(…)`
+ `readStreamInBackground` helper (‏אם לא בשימוש אחר — למחוק).

**אחרי**:
```ts
const acc = createGeminiUsageAccumulator()
const tap = new TransformStream<Uint8Array, Uint8Array>({
  transform(chunk, controller) {
    try { acc.push(chunk) } catch { /* tap fail-safe: לעולם לא לשבור את הזרם */ }
    controller.enqueue(chunk)
  },
  flush() {
    try {
      const u = acc.result()
      usageStore?.record({
        ts: Date.now(), provider: "google", cached: false,
        inputTokens: u.inputTokens, audioTokens: u.audioTokens,
        costUsd: geminiCostUsd(u.inputTokens, u.audioTokens),
      })
    } catch { /* metering לא-קריטי */ }
  },
})
return new Response(res.body.pipeThrough(tap), { status: res.status, headers: sanitizedHeaders })
```

**Verification**:
```bash
pnpm --filter @drive-coding/backend test    # טסטי proxy קיימים ירוקים
pnpm typecheck
# repro-under-load — ראה §5 (mock upstream, RSS יציב)
```

### Commit 2 — ElevenLabs cache path: `tee` → bounded cache-tap (approach: **manual**, backend)

**קובץ שמשתנה**: `packages/backend/src/delivery/http-proxy.ts` — הבלוק
"פיצול למטמון בהצלחה" (‏`res.body.tee()` השני).

**מה**: אותו דפוס — `TransformStream` שמזרים ל-client וצובר ל-cache **עם cap קשיח**.
מעל ה-cap → מפסיק לצבור, מסמן `truncated`, **מדלג על כתיבת המטמון** (‏audio גדול מדי
לא שווה מטמון). ה-`cacheStreamInBackground` הופך ל-writer bounded (‏או נעטף ב-cap).

**API skeleton** (‏helper משותף — "הדרך היחידה" לצבירה-מוגבלת):
```ts
// packages/backend/src/delivery/bounded-collect.ts  (חדש)
/** אוסף chunks עד cap. מעל ה-cap → truncated=true, לא צובר יותר. fail-safe. */
export function boundedCollector(capBytes: number): {
  push(chunk: Uint8Array): void
  done(): { bytes: Uint8Array; truncated: boolean }
}
```
ה-cap: `PROXY_CACHE_MAX_ENTRY_BYTES = 8 * 1024 * 1024` (‏const מנומק בקובץ).

**Verification**:
```bash
pnpm --filter @drive-coding/backend test
# בדיקת ידני: בקשת cacheable > cap → נכתב ל-client מלא, לא נכתב למטמון (x-cache=miss, אין קובץ)
```

### Commit 3 — RSS watchdog + 503 degradation (approach: **manual + live**, backend)

**קובץ חדש**: `packages/backend/src/delivery/memory-guard.ts`
**קבצים שמשתנים**: `packages/backend/src/server.ts` (‏יצירה + הזרקה), `http-proxy.ts` (‏בדיקה).

**API skeleton**:
```ts
export interface MemoryGuard {
  /** true אם RSS חצה את הסף — יש לדחות בקשות-proxy כבדות. */
  overBudget(): boolean
  stop(): void
}
export function createMemoryGuard(opts?: {
  thresholdBytes?: number  // default: 1_500 * 1024 * 1024
  intervalMs?: number      // default: 5_000
}): MemoryGuard
```
מימוש: `setInterval` שמעדכן flag מ-`process.memoryUsage().rss`; `.unref()` על ה-timer
(‏לא לחסום exit). ב-`http-proxy` (‏או middleware על `/proxy/*`): אם `memoryGuard?.overBudget()`
→ `return c.json({ error: "server memory pressure, retry" }, 503)` + `log.warn`.
threshold קונפיגורבילי ב-env (`RSS_BUDGET_MB`) — "גרסה מספקת, נשפר בעתיד".

**Verification**:
```bash
pnpm --filter @drive-coding/backend test
# live: הרץ BE עם RSS_BUDGET_MB=200, שלח בקשת /proxy → 503; הסר → 200
```

---

## §5 — DoD

| בדיקה | איך |
|---|---|
| ‏accumulator עמיד ל-chunk boundaries | ‏`pnpm --filter @drive-coding/core test gemini-usage-accumulator` — ירוק, כולל split מלאכותי |
| ‏`extractGeminiUsage` לא נשבר | ‏`pnpm --filter @drive-coding/core test extract` — ירוק |
| ‏typecheck נקי | ‏`pnpm typecheck` → 0 |
| ‏טסטי proxy קיימים ירוקים | ‏`pnpm --filter @drive-coding/backend test` |
| ‏**RSS יציב תחת stream גדול לא-נצרך** (‏ה-DoD המרכזי) | ‏script `scripts/repro-proxy-mem.mjs` (‏חדש): mock upstream ל-Gemini stream ~256MB, client לא-קורא → RSS delta < 50MB (‏מול >250MB היום). *ראה §5.1* |
| ‏usage עדיין נרשם | ‏mock upstream עם usageMetadata → `usageStore.summary()` מציג tokens נכונים |
| ‏cache > cap לא נכתב | ‏בקשת cacheable מדומה > 8MB → אין קובץ ב-`data/cache/proxy` |
| ‏degradation 503 | ‏`RSS_BUDGET_MB=200` → `/proxy/*` מחזיר 503; ללא → 200 |

### §5.1 — repro-under-load (‏עוגן ה-runtime-gate)
ה-executor יכתוב `scripts/repro-proxy-mem.mjs` שמרים את ה-Hono app עם `fetch` גלובלי
מוקק (‏מחזיר Response עם ReadableStream ~256MB בפורמט SSE של Gemini), שולח בקשת
`POST /proxy/google/v1beta/.../streamGenerateContent?alt=sse`, **לא קורא את גוף התגובה**
(‏מדמה FE מנותק), ומודד `process.memoryUsage().rss`. **פס**: delta < 50MB. זהו ה-repro
ההפוך ל-`/tmp/repro-tee3.mjs` שהוכיח את הבאג.

---

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|---|---|---|
| ‏ה-peek רץ inline בנתיב ה-client → parser יקר מאט audio | ‏repro (‏streaming עדין) | ‏ה-accumulator O(chunk), zero-retain; `try/catch` שלא שובר זרם. אסור regex כבד/JSON.parse על audio |
| ‏`TransformStream` לא מכבד backpressure ב-Bun (‏כמו tee) | ‏חשש-סימטרי | ‏**הופרך ב-repro**: `TransformStream` כן backpressures (‏67→86MB). ה-DoD §5.1 שומר על זה |
| ‏`flush` לא נקרא ב-abort (‏FE מנתק) → usage לא נרשם | ‏streams semantics | ‏מקובל (‏fail-safe: לא-למדוד עדיף מלקרוס). לתעד ב-walkthrough |
| ‏שבירת `extractGeminiUsage` הקיים בזמן ה-refactor ל-helper משותף | ‏DRY | ‏טסטי `extract.test.ts` חייבים להישאר ירוקים (‏DoD) |
| ‏Hardcoded Hebrew | ‏pre-commit hook | ‏אין UI/מחרוזות-משתמש כאן; הודעת 503 טכנית (‏לא i18n) — לוודא שלא בקוד-FE |
| ‏OneCLI placeholder — proxy לא מקבל keys | ‏learnings | ‏לא רלוונטי (‏mock upstream לאימות; לא קוראים ל-upstream אמיתי) |

---

## §7 — Escalation triggers

עצור ושאל את מרדכי ב-parent task אם:
- ‏`TransformStream`/`pipeThrough` ב-Bun מתנהג אחרת מה-repro (‏מבפר במקום backpressure) — מעיד על stack.
- ‏מתברר ש-`res.body` יכול להיות `null` בנתיב הזה בתרחיש לגיטימי (‏guard נדרש → החלטת-עיצוב).
- ‏ה-refactor ל-`parseGeminiChunkUsage` המשותף מחייב לשנות את חתימת `extractGeminiUsage` (‏חוזה core).
- ‏ה-503 degradation נוגע בנתיב שאינו `/proxy/*` (‏למשל חוסם WS/agents) — לא לחרוג מ-scope.

---

## §8 — Complexity score

- ‏commits: 4 (0–3) → סביר.
- ‏שכבות: core (‏accumulator) + backend (‏proxy transform, memory-guard) → 2.
- ‏streaming / async pipeline → **+2** (‏לב הסבב).
- ‏אין refactor state-model, אין שינוי protocol FE↔BE.
- ‏אריתמטי ≈ **6**.

**verifier: heavy** — למרות ~6, בוחרים **calev-heavy** כי ה-runtime-gate כאן הוא
**התנהגות-זיכרון-תחת-עומס** (‏regression של OOM), לא DoD פונקציונלי-רגיל ש-light תופס.
ה-README: "אם מהסס — heavy". כאן לא מהססים: memory-under-load דורש את הפרוטוקול הכבד.

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | ‏cap למטמון-ElevenLabs (‏Commit 2) — 8MB מתאים? | ‏8MB (‏const, קונפיג עתידי) | ❌ |
| 2 | ‏threshold ל-RSS watchdog | ‏1.5GB / `RSS_BUDGET_MB` env | ❌ |
| 3 | ‏האם 503 צריך `Retry-After` header | ‏לא בגרסה הזו (‏"נשפר בעתיד") | ❌ |
| 4 | ‏למחוק את `readStreamInBackground` לגמרי או להשאיר bounded | ‏למחוק אם אין צרכן אחר (‏grep לפני) | ❌ |
