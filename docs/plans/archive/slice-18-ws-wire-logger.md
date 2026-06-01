# Slice 18 — WS Wire Logger (passive bidirectional tap) — תוכנית

> **‏תאריך**: 2026-05-29
> **‏סטטוס**: ‏מאושר
> **‏Complexity**: 3/10 (verifier: light)
> **‏תלות**: ‏אין (logging-infra כבר קיים מ-2026-05-17)
> **‏מתבסס על**: `docs/plans/README.md`, `docs/plans/EXECUTOR_DISPATCH.md`, `packages/backend/AGENTS.md` (אם קיים — אחרת root)

---

## §0 — Pre-flight

‏⚠️ **‏אתה ה-executor** — ‏אתה מבצע את ה-brief הזה ‏ישירות. ‏**‏אל תdelegate** ל-sub-agent מסוג executor. ‏רק `verifier-slice-light` בסוף (§8). ‏אם נתקעת על משהו שלא מכוסה — ‏עצור ודווח ל-Tama ב-parent task. ‏ראה `EXECUTOR_DISPATCH.md §0`.

### Worktree

```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/slice-18-ws-wire-logger -b slice-18-ws-wire-logger dev
cd .worktrees/slice-18-ws-wire-logger
pnpm install
pnpm hooks:install
```

‏Base: dev tip `377f399`.

### Ports

| מה | פקודה |
|---|---|
‏| BE | `cd packages/backend && PORT=4000 onecli run --agent voice-acp -- bun --watch src/server.ts` (4000 אם פנוי, אחרת 4001/4002 — `EXECUTOR_DISPATCH §2`) |
‏| FE | `BE_PORT=<port> pnpm --filter @drive-coding/frontend-v2 dev` |

‏**‏חובה**: BE דרך OneCLI (agent `voice-acp`). ‏לבדיקת ה-slice צריך agent חי ששולח/מקבל ACP traffic.

### Browser

‏Chrome מקומי דרך tunnel (`https://your-app.nue.tuns.sh`) ‏או Vite local. ‏הבדיקה: ‏לחבר ל-opencode, ‏לשלוח prompt, ‏ולראות ב-**BE stdout** ‏שורות log של ה-wire traffic (כשמריצים עם `LOG_WIRE=ws`).

### OneCLI agent

‏שם: `voice-acp` (ID `3f08d584-4da0-4cb4-87b4-9611ae0fa9c0`). ‏שימוש: `onecli run --agent voice-acp -- <cmd>`.

### Reading list

‏**must-read (~‎10 ‏דק'):**

‏1. `packages/backend/src/delivery/ws-agent.ts` — **‏כל הקובץ (113 שורות)**. ‏זה ה-pipe. ‏שתי נקודות ה-tap:
   ‏- `child.stdout` → `feWs` ‏ב-`rl.on("line", ...)` (שורות 73-80) — ‏כיוון **agent→FE** (`dir: "in"`)
   ‏- `feWs.on("message", ...)` (שורות 83-91) — ‏כיוון **FE→agent** (`dir: "out"`)
‏2. `packages/core/src/log/config.ts:100-120` — `parseEnvConfig` + `LOG_WIRE` shortcut. ‏`LOG_WIRE=ws` ‏כבר ממפה ל-namespace `backend.ws.wire.*` ‏ומעלה level ל-trace. **‏ה-namespace קיים אבל אף אחד לא כותב אליו** — ‏זה מה שה-slice משלים.
‏3. `packages/core/src/log/types.ts:19-27` — ‏ה-`Logger` interface: `trace(fields?, msg?)`, `debug(fields?, msg?)`, `child(fields)`.
‏4. `packages/backend/src/delivery/http-client-log.ts:80-83` — ‏דוגמה לשימוש ב-`subLog.trace(fields, msg)` / `.debug(...)`.

‏**reference:**

‏- `packages/core/src/log/index.ts:80` — `createLogger(namespace): Logger`
‏- `packages/backend/src/log-setup.ts` — ‏מאתחל logger מ-env (כולל LOG_WIRE)

---

## §1 — מטרה

‏אחרי slice 18: ‏הרצת ה-BE עם `LOG_WIRE=ws` (או `LOG_WIRE=1`) ‏מדפיסה ל-stdout כל הודעת ACP שעוברת ב-pipe בשני הכיוונים — **‏בלי להשפיע על הזרם**. ‏הלוג מפענח את ה-NDJSON ל-summary (method/sessionUpdate/id) ‏ברמת `debug`, ‏ואת ה-JSON המלא ברמת `trace`.

‏החוויה (developer): 
```bash
LOG_WIRE=ws PORT=4000 onecli run --agent voice-acp -- bun --watch src/server.ts
# ‏כל tool_call / agent_message_chunk / prompt שעובר → שורת log עם dir + type + id
```

‏השימוש המיידי: ‏לענות על שאלת ה-replay — ‏לטעון סשן קיים ‏ולראות אילו `sessionUpdate` types ‏opencode שולח בהיסטוריה (thoughts? tools?). ‏אבל הכלי כללי — ‏שימושי לכל debug עתידי של ACP.

‏**‏עיקרון מנחה — ‏tap פסיבי**: ‏ה-logging **‏אסור** שישנה את ה-bytes, ‏את הסדר, ‏או את ה-timing של ה-pipe. ‏הוא קורא עותק, ‏מפענח ב-try/catch, ‏ולוג. ‏כשל בפענוח או log כבוי → ‏אפס השפעה.

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|---|---|---|
‏| ‏Wire tap דו-כיווני ב-`ws-agent.ts` (agent→FE + FE→agent) | ✅ | Commit 1 |
‏| ‏Namespace `backend.ws.wire` (child עם agentId) | ✅ | Commit 1 |
‏| `debug` level → summary (dir + type + id) | ✅ | Commit 1 |
‏| `trace` level → full decoded JSON | ✅ | Commit 1 |
‏| ‏util pure `decodeWireLine(line): WireSummary` + טסטים | ✅ | Commit 1 (TDD) |
‏| ‏Guard: ‏פענוח כושל / לא-JSON → ‏log קצר, ‏לא זורק, ‏לא נוגע ב-pipe | ✅ | Commit 1 |
‏| `LOG_WIRE=acp` (namespace `backend.acp.wire`) | ❌ | ‏ה-BE הוא byte-pipe — ‏אין שכבת ACP מפוענחת ב-BE. `acp.wire` יישאר ריק (future). ‏אנחנו ממלאים רק `ws.wire` |
‏| ‏שינוי ה-pipe logic (readline, stdin.write) | ❌ | ‏אסור — ‏tap בלבד |
‏| ‏Redaction של תוכן רגיש | ❌ | ‏future — ‏ה-traffic מקומי |
‏| ‏FE-side wire logging | ❌ | ‏future (יש כבר `?log=` ב-FE) |

---

## §3 — Architecture

```
‏feWs (browser)  ←──────────  ws-agent.ts pipe  ──────────→  child stdin/stdout (CLI)

‏agent→FE:  child.stdout → rl.on("line", line => {
‏             feWs.send(line+"\n")        ← ‏הזרם (לא נוגעים)
‏             wireLog(childLog, "in", line)  ← ‏ה-tap (חדש, פסיבי)
‏           })

‏FE→agent:  feWs.on("message", data => {
‏             child.stdin.write(line)     ← ‏הזרם (לא נוגעים)
‏             wireLog(childLog, "out", text)  ← ‏ה-tap (חדש, פסיבי)
‏           })

‏wireLog (helper מקומי ב-ws-agent.ts):
‏  - ‏אם logger לא enabled ל-trace/debug ב-ns → ‏return מיד (zero cost)
‏  - decode = decodeWireLine(line)   ← util pure (core או backend util)
‏  - childLog (ns backend.ws.wire) .debug({ dir, ...summary }) 
‏  - ‏ברמת trace: גם .trace({ dir, raw: decoded.full }, "wire")
```

‏**‏שכבות**: ‏ה-decode הוא pure logic → util עם טסטים. ‏ה-`logWire` helper מוגדר **‏בתוך `onConnect`** (לא ברמת מודול) ‏כי הוא משתמש ב-`childWireLog` שנוצר פר-connection עם `agentId`. ‏ה-`wireLog` (בלי child) הוא ברמת מודול. ‏**‏ה-skeleton ב-§4 הוא הסמכותי** — ‏עקוב אחריו במדויק.

‏**‏הערה על namespace**: ‏ה-`log` הקיים ב-`ws-agent.ts:25` הוא `createLogger("backend.ws.agent")`. ‏ל-wire צריך namespace **‏נפרד** `backend.ws.wire` (כי `LOG_WIRE=ws` ממפה ל-`backend.ws.wire.*`). ‏צור logger נוסף: `const wireLog = createLogger("backend.ws.wire")` ‏ברמת המודול, ‏ואז `wireLog.child({ agentId })` ב-onConnect.

---

## §4 — Commits

### Commit 1 — Wire decode util + tap (approach: mixed — TDD ל-util, integration ל-tap)

‏**מטרה**: ‏util pure לפענוח שורת NDJSON ל-summary, ‏+ ‏חיבור ה-tap הדו-כיווני ב-`ws-agent.ts`.

‏**קבצים חדשים**:

| ‏קובץ | ‏מטרה |
|---|---|
‏| `packages/backend/src/delivery/wire-decode.ts` | ‏פונקציה pure `decodeWireLine` (skeleton למטה) |
‏| `packages/backend/src/delivery/wire-decode.test.ts` | ‏~‎8-10 tests (TDD) |

‏**קבצים שמשתנים**:

| ‏קובץ | ‏שינוי |
|---|---|
‏| `packages/backend/src/delivery/ws-agent.ts` | ‏(a) הוסף `createLogger("backend.ws.wire")` ברמת מודול. (b) ב-onConnect צור `wireLog = ...child({ agentId })`. (c) helper מקומי `logWire(dir, raw)` שמפענח ולוג. (d) קרא ל-`logWire("in", line)` ב-`rl.on("line")` (אחרי `feWs.send`), ‏ול-`logWire("out", text)` ב-`feWs.on("message")` (אחרי `child.stdin.write`) |

‏**`wire-decode.ts` API skeleton**:

```ts
/**
 * Passive decode of an NDJSON wire line (one JSON-RPC / ACP frame) into a
 * compact summary for logging. NEVER throws — returns a "raw" summary on
 * parse failure so the caller can still log something without breaking the pipe.
 */
export type WireSummary = {
  /** JSON-RPC method (requests/notifications) if present. */
  method?: string
  /** ACP sessionUpdate type (agent_message_chunk / tool_call / ...) if present. */
  sessionUpdate?: string
  /** JSON-RPC id (request/response correlation) if present. */
  id?: string | number
  /** "result" | "error" for responses; undefined otherwise. */
  responseKind?: "result" | "error"
  /** true when the line was not valid JSON. */
  unparsed: boolean
  /** The parsed object (for trace-level full logging), or undefined if unparsed. */
  parsed?: unknown
}

export function decodeWireLine(line: string): WireSummary {
  let obj: unknown
  try {
    obj = JSON.parse(line)
  } catch {
    return { unparsed: true }
  }
  if (typeof obj !== "object" || obj === null) {
    return { unparsed: false, parsed: obj }
  }
  const o = obj as Record<string, unknown>
  const summary: WireSummary = { unparsed: false, parsed: obj }
  if (typeof o.method === "string") summary.method = o.method
  if (typeof o.id === "string" || typeof o.id === "number") summary.id = o.id
  if ("result" in o) summary.responseKind = "result"
  else if ("error" in o) summary.responseKind = "error"
  // ACP session/update notification: params.update.sessionUpdate
  const params = o.params as Record<string, unknown> | undefined
  const upd = params?.update as Record<string, unknown> | undefined
  if (upd && typeof upd.sessionUpdate === "string") summary.sessionUpdate = upd.sessionUpdate
  return summary
}
```

‏**`ws-agent.ts` tap skeleton** (additive — ‏לא לשנות את ה-pipe):

```ts
// ברמת המודול, ליד const log:
const wireLog = createLogger("backend.ws.wire")

// בתוך onConnect, אחרי childLog:
const childWireLog = wireLog.child({ agentId })

function logWire(dir: "in" | "out", raw: string): void {
  // zero-cost guard: if neither debug nor trace enabled for this ns, skip decode.
  // (The logger's own isEnabled gate also protects, but decode is cheap+guarded.)
  try {
    const s = decodeWireLine(raw)
    const type = s.sessionUpdate ?? s.method ?? s.responseKind ?? (s.unparsed ? "unparsed" : "unknown")
    childWireLog.debug({ dir, type, id: s.id }, "wire")
    if (!s.unparsed) childWireLog.trace({ dir, frame: s.parsed }, "wire-full")
  } catch {
    // never let logging break the pipe
  }
}

// ב-rl.on("line", line => { ... }) — אחרי feWs.send:
rl.on("line", (line) => {
  if (line.length === 0) return
  try {
    feWs.send(`${line}\n`)
  } catch {
    // feWs closing
  }
  logWire("in", line)   // ← tap (after send; failure-isolated)
})

// ב-feWs.on("message", data => { ... }) — אחרי child.stdin.write:
feWs.on("message", (data) => {
  try {
    const text = data.toString()
    const line = text.endsWith("\n") ? text : `${text}\n`
    child.stdin.write(line)
    logWire("out", text.trim())   // ← tap (after write). trim removes trailing \n so decodeWireLine sees a clean single frame.
  } catch (err) {
    childLog.warn({ err }, "stdin write failed")
  }
})
```

‏**‏גוטשה — ‏אל תזרוק מתוך ה-tap**: ‏ה-`logWire` ‏עטוף ב-try/catch פנימי. ‏גם אם decode מצליח אבל logger זורק (לא אמור) — ‏ה-pipe לא נפגע. ‏ב-`rl.on("line")` ‏ה-tap נקרא **‏אחרי** `feWs.send` ‏(אם send זורק, ה-catch הקיים תופס; ה-tap לא ירוץ — ‏זה בסדר, ‏עדיף לא ללוג מאשר לשבור).

‏**‏גוטשה — ‏FE→agent decode**: ‏ה-`text` ב-`feWs.on("message")` ‏עשוי להכיל `\n` בסוף (או כמה frames). `decodeWireLine` ‏מפענח שורה אחת; ‏אם ה-FE שולח frame בודד (הרגיל), ‏`JSON.parse(text.trim())` יעבוד. **‏החלטה**: ‏ב-`logWire("out", text)` ‏העבר `text.trim()` כדי להסיר `\n` סופי לפני decode. ‏אם זה multi-line (נדיר) → `decodeWireLine` יחזיר `unparsed:true` → ‏log "unparsed", ‏לא קריסה. ‏זה מקובל.

‏**Tests (TDD — `wire-decode.test.ts`)**:

```ts
describe("decodeWireLine", () => {
  it("JSON-RPC request → method + id", ...)            // {"jsonrpc":"2.0","method":"session/prompt","id":1}
  it("JSON-RPC result response → responseKind=result + id", ...)
  it("JSON-RPC error response → responseKind=error + id", ...)
  it("ACP session/update notification → sessionUpdate from params.update", ...)
    // {"method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk"}}}
  it("tool_call sessionUpdate extracted", ...)
  it("invalid JSON → unparsed:true, no throw", ...)
  it("non-object JSON (e.g. number) → unparsed:false, parsed set, no method", ...)
  it("empty params/update → no sessionUpdate, no throw", ...)
  it("parsed object is preserved in summary.parsed", ...)
})
```

‏**Verification**:
```bash
# ‏tests רצים מ-root (לפקג backend אין scripts.test משלו — רק dev/build/typecheck/start):
pnpm test -- wire-decode
pnpm --filter @drive-coding/backend typecheck

# ‏ידני — ‏tap חי:
LOG_WIRE=ws PORT=4002 onecli run --agent voice-acp -- bun --watch src/server.ts &
# ‏FE על 4002, ‏חבר ל-opencode, ‏שלח prompt "מה השעה"
# ‏ציפייה ב-BE stdout: שורות "wire" עם dir:"out" (prompt) ו-dir:"in" (chunks/tool_call)
# ‏בלי LOG_WIRE → ‏אין שורות wire (default level), ‏וה-pipe עובד כרגיל (no regression)
```

‏**DoD**:
‏- [ ] `wire-decode.ts` + ~‎8-10 tests ירוקים
‏- [ ] typecheck backend נקי
‏- [ ] עם `LOG_WIRE=ws` — ‏שורות wire מופיעות (dir in+out, type, id)
‏- [ ] בלי `LOG_WIRE` — ‏אין שורות wire, ‏וה-chat עובד כרגיל (no regression)
‏- [ ] decode על שורה לא-JSON → ‏log "unparsed", ‏לא קריסה

---

### Commit 2 — walkthrough + status (approach: none)

‏- `docs/walkthrough.md` — ‏רשומה: slice 18 ws-wire-logger (משלים את ה-wire ns שתוכנן ב-logging-infra 2026-05-17).
‏- ‏עדכן status ה-brief הזה ל-"‏הושלם".

---

## §5 — DoD (כולל)

| # | ‏בדיקה | ‏איך |
|---|---|---|
‏| 1 | typecheck backend | ‏אוטומטי |
‏| 2 | tests (כולל ~‎8-10 חדשים ל-wire-decode) | ‏אוטומטי |
‏| 3 | lint:i18n | ‏אוטומטי (אין מחרוזות עברית — קוד אנגלי) |
‏| 4 | `LOG_WIRE=ws` → ‏wire lines (in+out) | ‏ידני BE stdout |
‏| 5 | בלי LOG_WIRE → ‏אין wire lines + chat עובד (no regression) | ‏ידני |
‏| 6 | unparsed line → ‏לא קריסה | ‏ידני / test |
‏| 7 | `LOG_WIRE=ws` + loadSession של סשן קיים → ‏רואים אילו sessionUpdate types ב-replay | ‏ידני (זה ה-payoff) |

---

## §6 — Risks + mitigations

| # | ‏סיכון | ‏מקור | ‏מיטיגציה |
|---|---|---|---|
‏| 1 | ‏ה-tap משבש את הזרם (timing/order) | ‏הליבה | ‏ה-tap נקרא **‏אחרי** send/write, ‏read-only, ‏try/catch. ‏לא נוגע ב-bytes. DoD #5 ‏מאמת no-regression |
‏| 2 | decode throws ושובר את ה-callback | ‏general | `decodeWireLine` ‏עצמו try/catch על JSON.parse; `logWire` ‏עטוף try/catch נוסף |
‏| 3 | ‏overhead כש-log כבוי | ‏perf | ‏ה-logger מגן ב-`isEnabled` (config.ts:95) — `.debug()`/`.trace()` ‏יוצאים מוקדם. ‏ה-decode עצמו רץ תמיד — ‏אם זה יקר, ‏אפשר guard מוקדם, ‏אבל JSON.parse על שורה אחת זניח. ‏(אם ה-verifier חושב שצריך guard — ‏הוסף `if (!isEnabledForNs(...)) return` — ‏אבל זה micro-opt, ‏לא חוסם) |
‏| 4 | ‏מחרוזת עברית בקוד | convention | ‏אין — ‏כל הקוד אנגלי (log fields, comments מותר אנגלית) |
‏| 5 | ‏namespace שגוי → `LOG_WIRE=ws` לא תופס | config | ‏ה-namespace חייב להיות בדיוק `backend.ws.wire` (config.ts:110 ממפה `backend.ws.wire.*`). ‏ה-child מוסיף agentId → `backend.ws.wire` עדיין match ל-`.*` |

---

## §7 — Escalation triggers

‏עצור ושאל את Tama אם:
‏1. ‏ה-tap גורם ל-regression בזרם (chat נשבר עם/בלי LOG_WIRE) ‏ולא ברור למה
‏2. ‏ה-namespace `backend.ws.wire` ‏לא נתפס ע"י `LOG_WIRE=ws` (בעיה ב-config/namespace matching) — ‏צרף את הפלט
‏3. ‏opencode שולח frames במבנה ‏שלא תואם JSON-RPC/ACP (decode תמיד unparsed) — ‏צרף דוגמה

‏אחרת: ‏החלט והמשך, ‏תעד ב-commit.

---

## §8 — Complexity score: 3/10

| ‏פקטור | ‏ניקוד |
|---|---|
‏| ‏commits (1 + docs) | 0 |
‏| ‏שכבות (util + delivery tap) | +1 |
‏| ‏Pure decode logic | +1 |
‏| ‏Passive tap (זהירות מ-regression) | +1 |
‏| ‏סה"כ | **3** |

‏**Verifier**: `verifier-slice-light`. ‏ה-brief לverifier:
```
‏בדוק slice 18 ב-branch slice-18-ws-wire-logger, worktree .worktrees/slice-18-ws-wire-logger.
‏Brief: docs/plans/slice-18-ws-wire-logger.md. Base: 377f399.
‏בדוק DoD §5. ‏הרץ wire-decode tests + typecheck. ‏הפעל BE עם LOG_WIRE=ws (port X),
‏חבר ל-opencode, ‏שלח prompt → ‏ודא wire lines (in+out) ב-stdout. ‏בלי LOG_WIRE → ‏אין wire + chat עובד.
‏GO / NEEDS REVISION.
```

---

## §9 — שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|---|---|---|
‏| 1 | ‏guard מוקדם לפני decode (perf) כש-log כבוי? | ‏לא בסיבוב הזה — JSON.parse על שורה זניח. ‏אם profiling יראה בעיה → future | ❌ |
‏| 2 | ‏לתעד content מלא של tool_call ב-trace? | ‏כן — `trace` כבר מלוג את `s.parsed` המלא (כולל content). ‏זה ה-payoff ל-debug של slice 16 | ❌ |
‏| 3 | `LOG_WIRE=acp` (ns backend.acp.wire) | ‏לא ממומש — ‏ה-BE byte-pipe, ‏אין שכבת ACP מפוענחת ב-BE. ‏ה-`ws.wire` כולל את אותו מידע (decoded). ‏future אם תהיה שכבת ACP ב-BE | ❌ |

---

## §10 — מה הלאה

‏אחרי merge: ‏הכלי זמין מיד ל-debug של שאלת ה-replay (slice 16 scope). ‏future: FE-side wire pairing, `acp.wire` ns אם תהיה שכבת ACP ב-BE, redaction אם נחשוף traffic מרוחק.
