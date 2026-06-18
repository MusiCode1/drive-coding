# Slice wire-recorder-jsonl — WS Wire Recorder (NDJSON file tap) — תוכנית

> **תאריך**: 2026-06-17
> **סטטוס**: הושלם (branch: slice-wire-recorder-jsonl, 3 commits, ממתין למזוג)
> **Complexity**: 4/10 (verifier: light)
> **תלויות (`depends_on`)**: [] — בנוי ישירות על dev (נקודות ה-tap כבר קיימות מ-Phase 3 + slice-18)
> **Base**: dev
> **Dev tip**: `fb8c522`

---

## §0 — Pre-flight

> ⚠️ **אתה ה-executor** — אתה מבצע את ה-brief הזה ישירות. אל תdelegate ל-sub-agent מסוג executor. רק `verifier-slice-light` בסוף (§8). אם נתקעת על משהו שלא מכוסה — עצור ודווח למרדכי. ראה `docs/plans/EXECUTOR_DISPATCH.md §0`.

### תלויות (חובה!)

slice זה **אינו תלוי** בשום slice לא-merged:
- אין תלויות. בנוי ישירות על dev (`fb8c522`).
- הערה: נקודות ה-tap שאליהן מתחברים (`logWire("in"/"out")` ב-`ws-agent.ts`) כבר קיימות ב-dev מ-slice-18 (wire-logger, merged). אנחנו **לא** משנים אותן — מוסיפים קריאת recorder לידן.

### Worktree

```bash
cd /d/UserProjects/AI/drive-coding/dev
git worktree add .worktrees/slice-wire-recorder-jsonl -b slice-wire-recorder-jsonl dev
cd .worktrees/slice-wire-recorder-jsonl
pnpm install
pnpm hooks:install   # חובה — pre-commit ל-Hebrew lint
```

Base: dev tip `fb8c522`.

### איך להריץ

- BE: `cd packages/backend && PORT=4000 onecli run --agent voice-acp -- bun --watch src/server.ts` (4000 אם פנוי, אחרת 4001+ — `EXECUTOR_DISPATCH §2`)
- FE: `BE_PORT=<port> pnpm --filter @drive-coding/frontend-v2 dev`
- Tests: מ-root — `pnpm test -- wire-recorder` (לפקג backend אין `scripts.test` משלו)
- Typecheck: `pnpm --filter @drive-coding/backend typecheck`

**הפעלת ההקלטה (זה ה-payoff)**: הרץ את ה-BE עם `WIRE_RECORD=1`. כל session של agent ייצר קובץ `data/wire-recordings/<agentId>-<ts>.jsonl` עם שורת NDJSON לכל frame דו-כיווני.

### Browser

Chrome מקומי דרך Vite local או tunnel. הבדיקה: לחבר agent (claude/opencode), לשלוח prompt, ולוודא שנוצר קובץ `.jsonl` תחת `data/wire-recordings/` עם רשומות `dir:"in"` (agent→FE) ו-`dir:"out"` (FE→agent).

### OneCLI agent

שם: `voice-acp`. שימוש: `onecli run --agent voice-acp -- <cmd>`. צריך agent חי ששולח/מקבל ACP traffic כדי לבדוק.

### Reading list

**must-read (~10 דק'):**

1. `packages/backend/src/delivery/ws-agent.ts` — **כל הקובץ (145 שורות)**. זה ה-pipe. נקודות החיווט:
   - `onLine` callback (שורות 92-100) — כיוון **agent→FE** (`dir: "in"`). יש כבר `logWire("in", line)` בשורה 99.
   - `feWs.on("message")` (שורות 103-122) — כיוון **FE→agent** (`dir: "out"`). יש כבר `logWire("out", ...)` בשתי נקודות: שורה 112 ($/ping; שורה 113 היא ה-`return`) ושורה 118 (frame רגיל).
   - `onConnect` (שורה 54) — כאן פותחים session recorder.
   - `feWs.on("close")` (שורות 136-143) — כאן סוגרים את ה-recorder (`unsub()` כבר שם).
2. `packages/backend/src/app/recordings-store.ts` — **דגם ה-factory לחיקוי**: `createRecordingsStore(baseDir)` מחזיר אובייקט עם מתודות. `ensureDir` עם `mkdir(..., {recursive:true})`. נתיב דרך `path.resolve("data/...")` ב-server.ts. **חקה את הסגנון הזה** (factory, JSDoc עברית, return object).
3. `packages/backend/src/server.ts:53-96` — boot dependencies + `createAgentWsHandler({ orchestrator, bridgeManager })` (שורה 96). כאן מוסיפים `wireRecorder` ל-deps ומגדירים אותו מ-env.
4. `packages/backend/src/delivery/wire-decode.ts` — דוגמה ל-util pure נפרד עם טסטים (`decodeWireLine`). ה-recorder עוקב אחרי אותו עיקרון: `serializeWireRecord` pure + IO מופרד.

**reference:**

- `packages/core/src/log/config.ts:100-120` — דוגמה ל-env shortcut (`LOG_WIRE`). ה-`WIRE_RECORD` שלנו פשוט יותר (truthy → on).
- `packages/backend/src/delivery/wire-decode.test.ts` — סגנון הטסטים בפקג.

---

## §1 — מטרה

אחרי slice זה: הרצת ה-BE עם `WIRE_RECORD=1` מקליטה את **כל** התעבורה של כל session ל-WebSocket לקובץ NDJSON ייעודי ונקי (`data/wire-recordings/<agentId>-<ts>.jsonl`) — שורה אחת לכל frame, עם `{ts, dir, raw}`. הקובץ ניתן-לניתוח טריוויאלי (`grep`/`jq`) כדי לאתר את החריגות שאנחנו מחפשים: chunks ריקים (`"text":""`), הודעות כפולות (אותו `id`/`messageId` פעמיים), והתפלגות סוגי `sessionUpdate`. בלי `WIRE_RECORD` — אפס IO, אפס overhead, וה-pipe מתנהג כרגיל.

**עיקרון מנחה — tap פסיבי**: ההקלטה **אסור** שתשנה את ה-bytes, הסדר, או ה-timing של ה-pipe. היא כותבת עותק ל-stream נפרד, try/catch, ולא חוסמת. כשל בכתיבה או recorder כבוי → אפס השפעה על הצ'אט. זהה לעיקרון של slice-18 (wire-logger).

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|------|------|------|
| מודול `wire-recorder.ts` — factory `createWireRecorder({dir})` | ✅ | Commit 1 |
| `serializeWireRecord(ts, dir, raw)` pure + טסטים | ✅ | Commit 1 (TDD) |
| no-op כש-`dir===null` (אפס IO) | ✅ | Commit 1 |
| כתיבה אמיתית ל-`<dir>/<agentId>-<ts>.jsonl` (append NDJSON) | ✅ | Commit 1 |
| חיווט ב-`ws-agent.ts` — `open` ב-onConnect, `record` ליד כל `logWire`, `close` ב-feWs close | ✅ | Commit 2 |
| הזרקת `wireRecorder` ל-deps ב-`server.ts` + env flag `WIRE_RECORD` | ✅ | Commit 2 |
| ה-recorder לעולם לא זורק (try/catch בכל IO) | ✅ | Commit 1+2 |
| סקריפט ניתוח (ספירת ריקים/כפילויות) | ❌ | החלטת המשתמש — "רק ההקלטה". future. |
| FE-side recording | ❌ | future (יש `?log=` ב-FE) |
| Redaction של תוכן רגיש | ❌ | future — traffic מקומי |
| rotation / ניקוי קבצים ישנים | ❌ | future — debug tool, ניקוי ידני |
| שינוי לוגיקת ה-pipe (send/write/readline) | ❌ | אסור — tap בלבד |

> זו לא טבלת TODO. זו הגנה מ-scope creep. המשתמש בחר "Recorder ייעודי ל-JSONL" + "רק ההקלטה".

---

## §3 — Architecture

```
feWs (browser)  ←─────────  ws-agent.ts pipe  ─────────→  child stdin/stdout (CLI)

onConnect(feWs, agentId):
  rec = deps.wireRecorder.open(agentId)        ← חדש (פותח קובץ <agentId>-<ts>.jsonl)

agent→FE  (onLine callback):
  feWs.send(line+"\n")        ← הזרם (לא נוגעים)
  logWire("in", line)         ← קיים (slice-18)
  rec.record("in", line)      ← חדש (פסיבי, אחרי send)

FE→agent  (feWs.on("message")):
  // $/ping branch:
  feWs.send($/pong)           ← הזרם
  logWire("out", "$/ping...")  ← קיים
  rec.record("out", text)     ← חדש
  // frame רגיל:
  child.stdin.write(line)     ← הזרם
  logWire("out", text.trim())  ← קיים
  rec.record("out", text.trim()) ← חדש

feWs.on("close"):
  rec.close()                 ← חדש (סוגר את ה-write stream)

─────────────────────────────────────────────────────────

wire-recorder.ts (מודול חדש, factory בסגנון recordings-store):

  serializeWireRecord(ts, dir, raw): string     ← pure, testable
      → `${JSON.stringify({ts, dir, raw})}\n`

  createWireRecorder({ dir, now? }): WireRecorder
      dir===null  → no-op recorder (open מחזיר session ריק, אפס IO)
      dir set     → mkdirSync(dir, {recursive}) ב-factory;
                    open(agentId) → createWriteStream(<dir>/<agentId>-<ts>.jsonl, {flags:"a"})
      WireSession.record(dir, raw) → stream.write(serializeWireRecord(...))  [try/catch]
      WireSession.close()          → stream.end()                            [try/catch]

server.ts:
  const wireRecorder = createWireRecorder({
    dir: process.env.WIRE_RECORD ? path.resolve("data/wire-recordings") : null,
  })
  createAgentWsHandler({ orchestrator, bridgeManager, wireRecorder })   ← dep חדש
```

**שכבות**: serialize = pure logic → unit test טהור. ה-IO (createWriteStream/mkdir) = integration test עם tmp dir. החיווט ב-ws-agent = integration. **ה-skeleton ב-§4 הוא הסמכותי** — עקוב אחריו במדויק.

---

## §4 — Commits בסדר

### Commit 1 — wire-recorder module (approach: tdd ל-serialize + no-op, integration ל-write)

**מטרה**: מודול pure-ish שמקליט frames ל-NDJSON, עם no-op path כש-`dir===null`.

**קבצים חדשים**:

| קובץ | מטרה |
|------|------|
| `packages/backend/src/delivery/wire-recorder.ts` | factory + serialize (skeleton למטה) |
| `packages/backend/src/delivery/wire-recorder.test.ts` | ~8-10 tests |

**`wire-recorder.ts` API skeleton** (החתימות מדויקות — executor אסור לשנות):

```ts
/**
 * wire-recorder.ts — הקלטת tap פסיבית של תעבורת ה-WS לקובץ NDJSON.
 *
 * כל session של agent מקבל קובץ `<dir>/<agentId>-<ts>.jsonl`; כל frame שעובר
 * ב-pipe (שני הכיוונים) נכתב כשורה אחת `{ts, dir, raw}`. הכלי משמש לדיבוג של
 * חריגות ACP (chunks ריקים, הודעות כפולות). ר' slice-wire-recorder-jsonl.
 *
 * עיקרון: ה-recorder לעולם לא זורק ולא חוסם את ה-pipe — כל IO עטוף ב-try/catch,
 * וכש-dir===null ה-recorder הוא no-op מוחלט (אפס IO).
 */
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs"
import { join } from "node:path"

export type WireDir = "in" | "out"

/** Pure: serialize רשומת wire אחת לשורת NDJSON (כולל \n בסוף). */
export function serializeWireRecord(ts: number, dir: WireDir, raw: string): string {
  return `${JSON.stringify({ ts, dir, raw })}\n`
}

export type WireSession = {
  /** כותב frame בודד. לעולם לא זורק. no-op אם ה-recorder כבוי/נסגר. */
  record(dir: WireDir, raw: string): void
  /** סוגר את ה-write stream. לעולם לא זורק. אידמפוטנטי. */
  close(): void
}

export type WireRecorder = {
  /** פותח session חדש (קובץ) ל-agentId נתון. כש-dir===null → session no-op. */
  open(agentId: string): WireSession
}

const NOOP_SESSION: WireSession = { record() {}, close() {} }

/**
 * createWireRecorder — factory.
 * @param opts.dir   תיקיית יעד, או null ל-no-op מוחלט (WIRE_RECORD לא מוגדר).
 * @param opts.now   מקור ts (להזרקה בטסטים). default: Date.now.
 */
export function createWireRecorder(opts: {
  dir: string | null
  now?: () => number
}): WireRecorder {
  const now = opts.now ?? (() => Date.now())
  if (opts.dir === null) {
    return { open: () => NOOP_SESSION }
  }
  const dir = opts.dir
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    // אם אי אפשר ליצור תיקייה — נפול ל-no-op כדי לא לשבור את ה-pipe
    return { open: () => NOOP_SESSION }
  }
  return {
    open(agentId: string): WireSession {
      let stream: WriteStream | null = null
      try {
        stream = createWriteStream(join(dir, `${agentId}-${now()}.jsonl`), { flags: "a" })
        stream.on("error", () => { stream = null })   // דיסק מלא וכו' → השתק
      } catch {
        return NOOP_SESSION
      }
      return {
        record(d: WireDir, raw: string): void {
          if (stream === null) return
          try {
            stream.write(serializeWireRecord(now(), d, raw))
          } catch {
            // לעולם אל תיתן להקלטה לשבור את ה-pipe
          }
        },
        close(): void {
          try {
            stream?.end()
          } catch {
            // כבר סגור
          }
          stream = null
        },
      }
    },
  }
}
```

**Tests (TDD — `wire-recorder.test.ts`)**:

```ts
describe("serializeWireRecord", () => {
  it("מייצר שורת NDJSON עם ts/dir/raw + \\n בסוף", ...)
  it("escape תקין של raw עם מרכאות/newline פנימי (JSON.stringify)", ...)
})

describe("createWireRecorder — no-op (dir=null)", () => {
  it("open().record()/close() לא זורקים ולא כותבים כלום", ...)
})

describe("createWireRecorder — write (tmp dir)", () => {
  // השתמש ב-os.tmpdir() + mkdtempSync; now קבוע דרך opts.now
  it("open יוצר קובץ <agentId>-<ts>.jsonl", ...)            // בדוק קיום עם fs
  it("record('in'/'out') כותב שורות NDJSON תואמות serializeWireRecord", ...)
    // close() ואז readFileSync → split('\n') → JSON.parse כל שורה
  it("close מסיים — record אחרי close הוא no-op (לא זורק)", ...)
  it("שני open() שונים → שני קבצים נפרדים", ...)            // now שונה / agentId שונה
})
```

> **גוטשה — async write + assert**: `createWriteStream(...).write()` הוא buffered. בטסט, אחרי `record(...)` חובה `close()` ואז להמתין לאירוע `finish` (או `await once(stream,'finish')` דרך ה-session) לפני `readFileSync`. **המלצה**: בטסט קרא `close()` ואז המתן `await new Promise(r => setTimeout(r, 20))` לפני קריאת הקובץ — פשוט ומספיק ל-tmp local. אם flaky → עבור ל-`finish` event. (ה-stream.end() flush-ים את ה-buffer.)

> **גוטשה — `now()` נקרא פעמיים**: פעם ב-`open` (שם הקובץ) ופעם בכל `record` (ה-ts ברשומה). זה תקין ומכוון — שם הקובץ = זמן פתיחה, ts הרשומה = זמן ה-frame. בטסט עם `now` קבוע, שניהם שווים — בסדר.

> **גוטשה — `noUncheckedIndexedAccess` בטסטים (בעיה #4 של אביגיל)**: ה-tsconfig מפעיל `noUncheckedIndexedAccess: true`, אז בטסט `readFileSync(...).trim().split("\n")` ואז `lines[i]` מחזיר `string | undefined` ו-`JSON.parse(lines[0])` ייכשל ב-typecheck. השתמש ב-guard: `const parsed = lines.filter(Boolean).map((l) => JSON.parse(l))` ואז assert על `parsed[0]` עם optional chaining (`parsed[0]?.dir`), או `const l0 = lines[0]; if (l0 === undefined) throw new Error("no line")`. ה-skeleton עצמו נקי מ-index access — זה רק עניין של קוד הטסט.

**Verification**:
```bash
pnpm test -- wire-recorder
pnpm --filter @drive-coding/backend typecheck
```

**DoD Commit 1**:
- [ ] `wire-recorder.ts` + ~8-10 tests ירוקים
- [ ] typecheck backend נקי
- [ ] no-op path: dir=null → אפס IO, לא זורק
- [ ] write path: קובץ נוצר, שורות NDJSON תקינות

---

### Commit 2 — חיווט ב-pipe + env flag (approach: integration)

**מטרה**: לחבר את ה-recorder ל-`ws-agent.ts` ולהזריק אותו מ-`server.ts` עם `WIRE_RECORD`.

**קבצים שמשתנים**:

| קובץ | שינוי |
|------|------|
| `packages/backend/src/delivery/ws-agent.ts` | (a) הוסף `wireRecorder: WireRecorder` ל-type של `deps` ב-`createAgentWsHandler`. (b) ב-onConnect: `const rec = deps.wireRecorder.open(agentId)`. (c) הוסף `rec.record("in", line)` ב-onLine callback (אחרי `logWire("in", line)`). (d) הוסף `rec.record("out", text)` בענף ה-$/ping (אחרי `logWire("out", ...)`) ו-`rec.record("out", text.trim())` בענף הרגיל (אחרי `logWire("out", text.trim())`). (e) ב-`feWs.on("close")`: `rec.close()` (ליד `unsub()`). |

> **הבהרה לבעיה #3 של אביגיל — ה-arg בענף ה-$/ping**: ה-recorder מקליט את ה-`text` **הגולמי** (ה-$/ping המקורי שהגיע מה-FE), **לא** את ה-summary `"$/ping → $/pong"` שה-`logWire` שם מתעד. זה מכוון — מטרת ה-recorder היא raw tap נאמן לחוט, בעוד ה-logWire נותן summary לקריאת-אדם. כלומר: `logWire("out", "$/ping → $/pong")` נשאר כפי שהוא; אתה **מוסיף** שורה חדשה `rec.record("out", text)` עם ה-`text` הגולמי.
| `packages/backend/src/server.ts` | (a) `import { createWireRecorder } from "./delivery/wire-recorder.js"`. (b) `const wireRecorder = createWireRecorder({ dir: process.env.WIRE_RECORD ? path.resolve("data/wire-recordings") : null })` — ליד boot deps (שורה ~57). (c) הוסף `wireRecorder` ל-`createAgentWsHandler({ orchestrator, bridgeManager, wireRecorder })` (שורה 96). |

**גוטשה — סדר החיווט**: כל `rec.record(...)` חייב להיות **אחרי** ה-`logWire(...)` המקביל, שהוא בעצמו **אחרי** ה-send/write של הזרם. הזרם תמיד ראשון. ה-recorder אחרון. אם הזרם זורק (catch קיים) — ה-record לא ירוץ, וזה בסדר (עדיף לא להקליט מאשר לשבור).

**גוטשה — אסור לגעת בלוגיקת ה-pipe**: אל תשנה את `feWs.send`, `child.stdin.write`, `unsub`, או את ה-early-return של ה-$/ping. רק **מוסיף** שורות `rec.*` לידן.

**Verification**:
```bash
pnpm --filter @drive-coding/backend typecheck
pnpm lint:i18n   # אין מחרוזות עברית בקוד (JSDoc עברית מותר)

# ידני — הקלטה חיה:
WIRE_RECORD=1 PORT=4002 onecli run --agent voice-acp -- bun --watch src/server.ts &
# FE על 4002, חבר claude/opencode, שלח prompt "מה השעה"
ls packages/backend/data/wire-recordings/    # ציפייה: <agentId>-<ts>.jsonl
# בדוק תוכן:
cat packages/backend/data/wire-recordings/*.jsonl | jq -c '{dir, len: (.raw|length)}'
# ציפייה: רשומות dir:"out" (prompt) + dir:"in" (chunks/tool_call)

# בלי WIRE_RECORD → אין תיקייה/קובץ חדש, וה-chat עובד כרגיל (no regression)
```

**DoD Commit 2**:
- [ ] typecheck נקי, lint:i18n עובר
- [ ] עם `WIRE_RECORD=1` → קובץ `.jsonl` נוצר עם רשומות in+out
- [ ] בלי `WIRE_RECORD` → אין קובץ, chat עובד (no regression)
- [ ] ה-raw בקובץ מכיל את ה-frame המלא (כולל `agent_thought_chunk` עם ה-content המלא — זה ה-payoff לדיבוג הריקים)

---

### Commit 3 — walkthrough + status (approach: none)

- `docs/walkthrough.md` — רשומה: slice wire-recorder-jsonl (NDJSON file tap להקלטת תעבורת WS, משלים את slice-18 wire-logger עם פלט ניתן-לניתוח).
- `data/wire-recordings/` — ודא שהוא ב-`.gitignore` (כמו `data/recordings`, `data/cache`). אם `data/` כבר ignored — אין צורך. **בדוק** `.gitignore` ל-`data/`.
- עדכן status ה-brief הזה ל-"הושלם".

---

## §5 — DoD verifiable

| # | בדיקה | איך |
|---|------|------|
| 1 | typecheck backend | `pnpm --filter @drive-coding/backend typecheck` |
| 2 | tests (כולל ~8-10 חדשים ל-wire-recorder) | `pnpm test -- wire-recorder` |
| 3 | lint:i18n (אין מחרוזות עברית — קוד אנגלי, JSDoc עברית מותר) | `pnpm lint:i18n` |
| 4 | `WIRE_RECORD=1` → קובץ `.jsonl` עם רשומות in+out | ידני: ls + cat `data/wire-recordings/*.jsonl` |
| 5 | בלי `WIRE_RECORD` → אין קובץ + chat עובד (no regression) | ידני |
| 6 | ה-raw מכיל frame מלא (`agent_thought_chunk` עם content מלא) | ידני: `jq 'select(.raw|contains("agent_thought_chunk"))' *.jsonl` |
| 7 | recorder כבוי (dir=null) → אפס IO, לא זורק | test (no-op) |
| 8 | `data/` ב-.gitignore (אין הקלטות ב-git) | `git status` נקי אחרי הקלטה |

---

## §6 — Risks + mitigations

| # | סיכון | מקור | מיטיגציה |
|---|------|------|----------|
| 1 | ה-recorder משבש את הזרם (timing/order) | הליבה | ה-record נקרא **אחרי** send/write/logWire, write ל-stream נפרד, try/catch. לא נוגע ב-bytes. DoD #5 מאמת no-regression |
| 2 | write זורק (דיסק מלא / EACCES) ושובר את ה-callback | IO | כל `record`/`close` עטוף try/catch; `stream.on("error")` משתיק ומאפס ל-null; mkdir כושל → no-op recorder |
| 3 | מחרוזת עברית בקוד | convention | אין — קוד אנגלי. JSDoc/comments עברית מותר (כמו שאר הפקג). `pnpm lint:i18n` חוסם |
| 4 | הקלטות נכנסות ל-git | hygiene | `data/` כבר אמור להיות ב-.gitignore (recordings-store + cache שם). Commit 3 מאמת |
| 5 | overhead כש-WIRE_RECORD כבוי | perf | `dir===null` → `open` מחזיר NOOP_SESSION; `record`/`close` הם פונקציות ריקות. אפס IO, אפס alloc משמעותי |
| 6 | async write flush בטסט (assert לפני flush) | test flake | close() עושה `stream.end()` (flush); הטסט ממתין 20ms או על `finish` לפני readFile — ר' גוטשה §4 |
| 7 | backpressure (stream buffer מתמלא) | perf | ל-debug tool מקובל להתעלם — Node מ-buffer בזיכרון. write מחזיר false → מתעלמים. traffic ACP מקומי קטן |

> 3 שתמיד נשכחים:
> 1. Hardcoded strings → i18n: **לא רלוונטי** (אין UI strings; קוד BE אנגלי)
> 2. Reactivity gotchas: **לא רלוונטי** (BE, אין Svelte)
> 3. OneCLI placeholder: **לא רלוונטי** (אין proxy/TTS כאן) — אבל הרץ BE דרך OneCLI בכל זאת (§EXECUTOR_DISPATCH 3)

---

## §7 — Escalation triggers

עצור ושאל את מרדכי אם:
1. ה-tap גורם ל-regression בזרם (chat נשבר עם/בלי WIRE_RECORD) ולא ברור למה
2. נדרש לשנות את לוגיקת ה-pipe (send/write/readline) כדי לחבר את ה-recorder — אסור; אם נראה הכרחי, Escalate
3. `data/` **לא** ב-.gitignore והקלטות נכנסות ל-git — שאל לפני שמוסיף ל-.gitignore (אולי יש מבנה אחר)
4. ה-WriteStream API מתנהג אחרת תחת bun (לא Node) באופן ששובר את הכתיבה — צרף את השגיאה

אחרת: החלט והמשך, תעד ב-commit.

---

## §8 — Complexity score + verifier tier

| פרמטר | ניקוד |
|------|------|
| Streaming/real-time (WS context — אבל passive tap בלבד) | +2 |
| IO (file write stream) | +1 |
| מודול חדש greenfield (אין call sites קיימים ל-recorder) | -1 |
| TDD ל-serialize + no-op | -1 |
| חיווט ב-2 קבצים (ws-agent + server) + deps injection | +1 |
| Passive tap (זהירות מ-regression) | +1 |
| Pure-ish (serialize טהור, IO מבודד) | -1 |
| **סה"כ** | **4** |

**Score**: 4/10

**Tier**: 0-3 → light בלבד; 4-7 → light + phase על commit מסוכן. כאן: **`verifier-slice-light`** בסוף. אופציונלי `verifier-phase` אחרי Commit 2 (החיווט ב-pipe — נקודת ה-regression). מומלץ phase אחרי Commit 2.

**Verifier-phase אחרי commit/phase**: Commit 2 (אופציונלי — נקודת ה-regression בזרם).

**הbrief ל-verifier (light)**:
```
בדוק slice wire-recorder-jsonl ב-branch slice-wire-recorder-jsonl,
worktree .worktrees/slice-wire-recorder-jsonl. Brief: docs/plans/slice-wire-recorder-jsonl.md.
Base: fb8c522. בדוק DoD §5. הרץ wire-recorder tests + typecheck + lint:i18n.
הפעל BE עם WIRE_RECORD=1 (port חופשי), חבר agent, שלח prompt → ודא קובץ .jsonl
עם רשומות in+out ו-raw מלא. בלי WIRE_RECORD → אין קובץ + chat עובד. ודא data/ ב-.gitignore.
GO / PARTIAL / NO-GO.
```

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|------|----------|------|
| 1 | להקליט גם את ה-$/ping keepalive (כיוון out)? | **כן** — נאמן ל"כל התעבורה". רעש קל, קל לסנן בניתוח (`jq 'select(.raw|contains("$/ping")|not)'`). זה גם מאפשר לזהות אם keepalive גורם לבעיות timing | ❌ |
| 2 | פורמט שם הקובץ — `<agentId>-<ts>` או `<ts>-<agentId>`? | `<agentId>-<ts>` — קל לקבץ לפי agent. ts מאפשר sort כרונולוגי בתוך agent | ❌ |
| 3 | ערך `WIRE_RECORD` — truthy בלבד או path מותאם? | truthy → `data/wire-recordings/`. path מותאם = future אם יידרש | ❌ |
| 4 | `Date.now()` ב-ts — מותר? | כן. זה קוד BE רגיל (לא workflow script). מוזרק כ-`now` להזרקה בטסטים | ❌ |
| 5 | rotation/ניקוי קבצים ישנים? | לא — debug tool, ניקוי ידני. `data/` ב-gitignore | ❌ |

---

## §10 — מה הלאה

אחרי merge: הכלי זמין מיד לדיבוג של בעיית ה-`agent_thought_chunk` הריק — מריצים עם `WIRE_RECORD=1`, משחזרים את התופעה, ומנתחים את ה-`.jsonl` כדי לאמת אם ה-`text:""` כבר מגיע ריק מה-CLI child (סביר — ה-BE שקוף) או נוצר אצלנו. future: סקריפט ניתוח (ספירת ריקים/כפילויות), FE-side recording, redaction אם נחשוף traffic מרוחק.

> **לייב — אין צורך ב-mode נפרד**: הקובץ נכתב ב-append בזמן אמת, אז `tail -f data/wire-recordings/*.jsonl | jq ...` נותן זרם חי מפוענח ונקי — שקול ל-`LOG_WIRE=ws` ל-use case של חקירת תעבורה.

> **כיוון איחוד עתידי (החלטת המשתמש, לא בסלייס הזה)**: כרגע מקובלת כפילות מנגנונים —
> ה-recorder (`WIRE_RECORD`, לקובץ NDJSON גולמי) לצד ה-wire-logger (`LOG_WIRE=ws`, דרך
> pino ל-stdout, מפוענח ל-summary). שניהם יושבים על אותן נקודות tap ב-`ws-agent.ts`.
> **בהמשך**: לאחד כך שמנגנון ההקלטה הזה יהיה ה-sink המשותף, וה-logging (pino) יכתוב
> **דרכו** — במקום שני taps נפרדים, tap אחד גולמי + שכבת פענוח/פורמט מעליו. כך אין כפילות
> ב-call sites של ה-pipe, וה-raw תמיד נשמר. דורש slice נפרד (refactor של שכבת ה-tap).

---

## סטיות מהתכנון (מתעדכן ע"י executor תוך כדי)

> ה-executor מתעד פה כל סטייה מה-brief ולמה.

- **core dist חסר בworktree חדש** — פתרון: `pnpm --filter @drive-coding/core build` (gotcha מתועד).
- **בדיקה ידנית חיה** (DoD §5 #4-6) — לא אומתה ב-Windows (onecli נדרש); תועד ב-commit message ובwalkthrough כ"ממתין ל-verifier/Tama".
- **tests/ws-agent-pipe.test.ts עודכן** — הטסטים הקיימים לא כללו wireRecorder ב-deps. הוספת noopWireRecorder לכל הקריאות. זה חלק מ-approach integration (Commit 2) ולא סטייה מה-brief.
