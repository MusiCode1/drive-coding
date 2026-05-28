# Slice 10 F-1 Fix — In-Process Bridge + Node-Ready WS

```yaml
verifier-slice: heavy
complexity-score: 10
testing-strategy: integration  # ה-DoD העיקרי הוא integration tests שהפכים מאדום לירוק
```

> **מטרה:** החלפת שכבת ה-bridge (`bridge-spawn.ts` + `bridge-manager.ts` +
> `stdio-to-ws` npx subprocess) במימוש in-process שמשתמש ב-`node:child_process.spawn`
> ישירות, ובהעברת שכבת ה-WS מ-`Bun.serve` ל-`@hono/node-server` + `ws.WebSocketServer`.
> זה פותר את F-1 (BE קורס על ENOENT npx) וגם מסיר Bun-lock (הקוד ירוץ גם על Node).
>
> **Worktree:** `/home/user/projects/voice-acp-v3`
> **Branch:** `vnext-fe-orchestrated`
> **HEAD בסיס:** `3412f1b` (אחרי commit של ה-red regression tests)
>
> **Slice scope:** Backend בלבד. FE לא נוגעים. החוזה החיצוני עם ה-FE (/api/agents, /ws/agent/:id) זהה.
>
> **Sub-agent:** Sonnet 4.6 (executor) + verifier-slice-heavy בסוף.

---

## 1. רקע קצר

ה-tester מצא ב-`docs/slice-10-exploratory-test-report.md` (F-1, blocker):
ה-BE process קורס עם `uncaughtException: spawn ENOENT npx` כשמנסים ליצור agent עם cwd פגום או כש-PATH לא מכיל `npx`. ה-root cause:

ב-`packages/backend/src/acp/bridge-spawn.ts:49`:
```ts
const child = spawn(opts.bin, [...opts.args], {...})  // bin = "npx"
if (!child.pid) throw new Error("spawn returned no pid")  // line 55
return new Promise<SpawnResult>((resolve, reject) => {
  // ... child.on("error", ...)  ← נרשם רק ב-line 144, אחרי ה-Promise constructor
})
```

כש-Bun מבצע `spawn("npx")` ו-PATH לא מכיל npx: ה-child מוחזר עם `pid=undefined`, אבל גם async פולט `error` event מאוחר יותר. ה-`throw` ב-line 55 מתבצע לפני שאי-פעם מגיעים ל-`new Promise(...)` ולכן ה-error listener לעולם לא נרשם. ה-event מבעבע ל-process כ-uncaughtException וBun יוצא.

ב-`packages/backend/tests/bridge-failure-integration.test.ts` יש 3 tests שמשחזרים את זה עם BE subprocess אמיתי ו-PATH מצומצם. כרגע שלושתם **אדומים**. ה-DoD העיקרי של ה-slice הזה הוא: שלושתם ירוקים.

ב-`packages/backend/tests/bridge-failure-modes.test.ts` יש 8 unit tests שעוברים כיום ומגדירים את ה-ה-API חוזה לכשל ב-spawn — גם בקוד החדש הם חייבים להמשיך לעבור.

---

## 2. ארכיטקטורה — לפני ואחרי

### לפני

```
BE process (Bun.serve)
   ↓ Bun.serve.upgrade
feWs (Bun ServerWebSocket)
   ↕ proxy ב-ws-agent.ts
bridgeWs (ws library, new WebSocket("ws://127.0.0.1:port/"))
   ↕ TCP loopback
stdio-to-ws subprocess (npx -y @rebornix/stdio-to-ws ...)
   ↕ stdio
opencode acp child
```

4 שכבות. שני spawns (npx, opencode). port allocation אקראי. ה-async error בשכבת npx לא נתפס.

### אחרי

```
BE process (Node http.createServer מ-@hono/node-server)
   ↓ httpServer.on("upgrade") → wss.handleUpgrade
feWs (ws.WebSocket מ-ws library, noServer mode)
   ↕ pipe ב-ws-agent.ts (custom, ~30 שורות)
opencode acp child (spawned ב-node:child_process.spawn ישיר ב-POST /api/agents time)
```

2 שכבות. spawn אחד. אין port allocation. ה-error events על ה-child נרשמים מיד אחרי ה-spawn ולעולם לא מתחמקים.

---

## 3. ספריות חדשות

ב-`packages/backend/package.json`:
- הוסף `@hono/node-server` (latest, ~^1.13.0)

אסור: לא להוסיף את `stdio-to-ws` כ-dep. מימוש פנימי בלבד.

אסור: לא להסיר את `ws` או `@types/ws` — אנחנו משתמשים בהם.

---

## 4. Files Affected

### Delete (בטוח)

| Path | Lines | סיבה |
|------|--------|------|
| `packages/backend/src/acp/bridge-spawn.ts` | 152 | מוחלף על-ידי spawn ישיר ב-bridge-manager |
| `packages/backend/src/acp/cli-config.ts:54-66` (`buildStdioToWsArgs`) | 13 | לא עוטפים עם stdio-to-ws — עוברים ישר אל ה-child |
| `packages/backend/tests/bridge-spawn.test.ts` | 32 | `parsePortFromStdout` מנותק |

### Modify (שכתוב משמעותי)

| Path | שינוי |
|------|--------|
| `packages/backend/src/acp/bridge-manager.ts` | שכתוב מלא — ראה phase 2 |
| `packages/backend/src/delivery/ws-agent.ts` | שכתוב של ה-pipe (ראה phase 3) |
| `packages/backend/src/server.ts` | מעבר מ-Bun.serve ל-@hono/node-server + ws.WebSocketServer (ראה phase 1) |
| `packages/backend/src/delivery/ws-echo.ts` | ייתכן שצריך התאמה ל-API החדש של ws |
| `packages/backend/src/app/agent-orchestrator.ts` | ייתכן שינוי ב-`spawnWithStderr` API (אם ה-shape משתנה) |
| `packages/backend/tests/bridge-manager.test.ts` | עדכון ל-API חדש |
| `packages/backend/tests/agent-orchestrator.test.ts` | עדכון ל-API חדש |
| `packages/backend/tests/ws-agent-pipe.test.ts` | עדכון ל-API חדש |

### Keep (אין שינוי)

- `packages/backend/src/acp/cli-config.ts:1-49` (`getCliCommand`) — נשאר (רק מסיר את `buildStdioToWsArgs`)
- FE בכלל לא נוגעים
- proxy (http-proxy.ts), recordings, sessions, projects — לא מושפעים

---

## 5. Anti-patterns — אל תעשה

### Process management

- ❌ אל תוסיף `process.on("uncaughtException", () => {})` שלא יוצא. זה anti-pattern. אם רושמים — רק ל-log + `process.exit(1)` graceful.
- ❌ אל תוסיף `process.on("unhandledRejection", ...)` ללא exit (אותה סיבה).
- ✅ הקוד אמור לא לייצר uncaught מלכתחילה. ה-uncaughtException handler הוא safety-net לcase שלא צפינו.

### Spawn

- ❌ אל תקרא ל-`spawn` בלי לרשום מיד אחר כך `child.on("error", ...)` ו-`child.on("exit", ...)`. רישום לפני ה-async tick.
- ❌ אל תזרוק על `!child.pid` בלי שהוספת listeners ראשון. זה בדיוק ה-bug של F-1.
- ✅ רישום listeners מיד אחרי ה-spawn, ואז בדיקה של `child.pid`.

### Logging

- ❌ אל תשתמש ב-`console.log/error` ב-קוד חדש. רק `createLogger("backend.X.Y")` מ-`@drive-coding/core/log`.
- ❌ אל תדפיס כל הודעה עוברת ב-pipe (ה-lib עשתה את זה וזיהמה את הlog). רק אירועים: spawn, exit, error.

### WS lifecycle

- ❌ אל תקרא ל-`child.kill()` ב-`ws.on("close")`. אנחנו רוצים שה-child ישרוד FE disconnect. ה-child נהרג רק ב-`DELETE /api/agents/:id` או ב-shutdown.
- ✅ ב-`ws.on("close")` — רק cleanup של ה-listeners שה-pipe רשם (`rl.close()`, וכו').

### Cross-runtime

- ❌ אל תשתמש ב-`Bun.serve` ב-קוד החדש. ה-stack צריך לרוץ גם על Node.
- ❌ אל תשתמש ב-`Bun.write`, `Bun.file`, או גלובלי-Bun אחר.
- ✅ רק stdlib (`node:*`) + `@hono/node-server` + `ws`.

---

## 6. Data Flow Bridges

| Producer | Consumer | Data | Mechanism | קובץ:שורה אחרי שינוי |
|----------|----------|------|-----------|------------------|
| `POST /api/agents` | `bridgeManager.spawn()` | cwd, cliKind, env | orchestrator קורא עם input מה-API | `agent-orchestrator.ts:createAndSpawn` |
| `bridgeManager.spawn` | `children Map` | `agentId → ChildProcess` | שמירת reference ב-Map | `bridge-manager.ts` |
| `bridgeManager.spawn` | `child.on("exit")` | exit code | listener רשום מיד אחרי spawn → notifyCrash | `bridge-manager.ts` |
| `ws-agent open()` | children Map | agentId | lookup של child ב-Map | `ws-agent.ts` |
| child.stdout | feWs | NDJSON lines | readline + ws.send | `ws-agent.ts` (`pipeChild`) |
| feWs.message | child.stdin | NDJSON | child.stdin.write(data + "\n") | `ws-agent.ts` (`pipeChild`) |
| feWs.close | pipe listeners | (signal) | rl.close + listeners off (אבל NO child.kill) | `ws-agent.ts` (`pipeChild`) |
| child.stderr | agent.crashReason | rolling buffer (last 200 lines) | stderr listener ב-bridge-manager → `Map<agentId, string[]>` | `bridge-manager.ts` |
| child.exit (crash) | registry.update | status="crashed", crashReason | extractProviderError(stderrBuf) → registry.update | `bridge-manager.ts` → orchestrator.onCrash |
| `DELETE /api/agents/:id` | child.kill | SIGTERM (SIGKILL אחרי 5s) | orchestrator.deleteAndKill → bridgeManager.kill | `bridge-manager.ts:kill` |

חובה לכל שורה: integration test שעובר על שני הצדדים.

---

## 7. Phases

### Phase 1 — Server foundation (`@hono/node-server` + `ws.WebSocketServer`)

**Testing:** integration

**מטרה:** החלפת ה-server transport מ-`Bun.serve` ל-`http.createServer` דרך `@hono/node-server`, עם ws.WebSocketServer ב-noServer mode מחובר ל-`httpServer.on("upgrade")`. בלי לגעת בלוגיקת ה-bridge עדיין — הbridge הישן ימשיך לעבוד.

**משימות:**

1. ב-`packages/backend/package.json`: `pnpm add @hono/node-server`.

2. ב-`packages/backend/src/server.ts`:
   - הסר את `Bun.serve(...)` ואת ה-`type WsData` combo + dispatch logic.
   - השתמש ב-`createServer` + `serve` מ-`@hono/node-server`:
     ```ts
     import { serve } from "@hono/node-server"
     const httpServer = serve({ fetch: app.fetch, port })
     ```
   - הוסף `ws.WebSocketServer({ noServer: true })` לכל route WS:
     ```ts
     const echoWss = new WebSocketServer({ noServer: true })
     const agentWss = new WebSocketServer({ noServer: true })
     ```
   - ב-`httpServer.on("upgrade", (req, socket, head) => {...})`: route לפי url אל ה-WSS המתאים עם `wss.handleUpgrade`.

3. ב-`packages/backend/src/delivery/ws-echo.ts`:
   - שנה מ-Bun `WebSocketHandler<EchoWsData>` ל-`(ws: WebSocket) => void` (ws library).
   - את ה-API על ws library: `ws.on("message", ...)`, `ws.on("close", ...)`, `ws.send(...)`.

4. ב-`packages/backend/src/delivery/ws-agent.ts`:
   - באותו אופן, API של ws library. אבל את ה-logic הפנימי השאר לפעם הזו — עדיין פותח `new WebSocket(\`ws://127.0.0.1:${port}/\`)` ל-bridge הישן (יוחלף ב-Phase 3).

**DoD:**
- `pnpm typecheck` + `pnpm lint` ירוקים
- `packages/backend/tests/http*.test.ts` + `ws-echo.test.ts` + `ws-agent-pipe.test.ts` עוברים (ייתכן שיצריך עדכון של ה-tests ל-API החדש — זה OK)
- ה-tests האדומים עדיין אדומים (עוד לא תיקנו את ה-bridge)
- smoke ידני: `curl http://localhost:4000/api/health` עובד אחרי שמרימים BE
- לוג: `{ns: "backend.server", port}` עם msg "listening"

**Commit:** `refactor(backend): Phase 1 — server foundation עובר ל-@hono/node-server + ws.WebSocketServer (slice 10 f1)`

---

### Phase 2 — New `bridge-manager.ts` עם spawn ישיר

**Testing:** tdd (unit tests ב-`bridge-manager.test.ts` מעודכנים)

**מטרה:** שכתוב מלא של `bridge-manager.ts` לעבוד ישירות מול `node:child_process.spawn` ב-eager mode (spawn ב-POST time, ה-child חי עד ל-DELETE).

**משימות:**

1. מחק את `packages/backend/src/acp/bridge-spawn.ts` (152 שורות).
2. מחק את `packages/backend/tests/bridge-spawn.test.ts` (32 שורות).
3. ב-`packages/backend/src/acp/cli-config.ts`: מחק את `buildStdioToWsArgs` (שורות ~54-66). השאר את `getCliCommand`.

4. שכתוב `packages/backend/src/acp/bridge-manager.ts`:

   ```ts
   import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
   import type { BridgeHandle, BridgeManager, SpawnBridgeInput } from "@drive-coding/core"
   import { createLogger } from "@drive-coding/core/log"
   import { getCliCommand } from "./cli-config.js"
   
   const log = createLogger("backend.bridge.manager")
   const STDERR_MAX_LINES = 200
   
   export type BridgeHandleWithStderr = BridgeHandle & {
     readonly getStderr: () => string[]
     readonly child: ChildProcessWithoutNullStreams
   }
   
   export function createBridgeManager(): BridgeManager & {
     spawnWithStderr(bridgeId: string, input: SpawnBridgeInput): Promise<BridgeHandleWithStderr>
     getChild(bridgeId: string): ChildProcessWithoutNullStreams | null
   } {
     type Entry = {
       handle: BridgeHandle
       child: ChildProcessWithoutNullStreams
       stderrLines: string[]
     }
     const store = new Map<string, Entry>()
     const crashHandlers = new Set<(bridgeId: string, exitCode: number | null) => void>()
     
     async function spawnInternal(bridgeId: string, input: SpawnBridgeInput): Promise<BridgeHandleWithStderr> {
       if (store.has(bridgeId)) throw new Error(`Bridge ${bridgeId} already exists`)
       
       const cli = getCliCommand(input.cliKind, input.modelOverride)
       const childLog = log.child({ bridgeId, cwd: input.cwd, bin: cli.bin })
       childLog.info({}, "spawn start")
       
       const stderrLines: string[] = []
       let stderrPartial = ""
       
       let child: ChildProcessWithoutNullStreams
       try {
         child = spawn(cli.bin, [...cli.args], {
           cwd: input.cwd,
           env: process.env,  // מירוש PATH ושאר env
           stdio: ["pipe", "pipe", "pipe"],
         })
       } catch (err) {
         // Bun edge case: spawn זורק synchronously על ENOENT
         childLog.warn({ err }, "spawn threw synchronously")
         throw err
       }
       
       // רישום listeners מיד — לפני שאי-פעם יכול לפלוט async error
       child.on("error", (err) => {
         childLog.warn({ err: { message: err.message, code: (err as NodeJS.ErrnoException).code } }, "child error event")
         // אם אין pid → notifyCrash. אחרת ה-error הוא runtime ויפוטר ב-exit.
         if (!child.pid && store.has(bridgeId)) {
           store.delete(bridgeId)
           notifyCrash(bridgeId, null)
         }
       })
       
       child.stderr.on("data", (chunk: Buffer) => {
         const text = stderrPartial + chunk.toString("utf8")
         const parts = text.split("\n")
         for (let i = 0; i < parts.length - 1; i++) {
           stderrLines.push(parts[i] ?? "")
           if (stderrLines.length > STDERR_MAX_LINES) stderrLines.shift()
         }
         stderrPartial = parts[parts.length - 1] ?? ""
       })
       
       child.on("exit", (code) => {
         childLog.info({ code }, "child exit")
         if (store.has(bridgeId)) {
           store.delete(bridgeId)
           notifyCrash(bridgeId, code)
         }
       })
       
       if (!child.pid) {
         // ה-error event יטפל ב-cleanup בנפרד. מחזירים error לcaller.
         throw new Error(`spawn returned no pid (bin=${cli.bin})`)
       }
       
       const handle: BridgeHandle = {
         bridgeId,
         cliKind: input.cliKind,
         cwd: input.cwd,
         port: 0,  // אין port — in-process. שדה נשאר ב-schema לתאימות אחורה.
         pid: child.pid,
         wsUrl: "",  // אין URL — אותו הסבר.
         startedAt: new Date(),
       }
       
       store.set(bridgeId, { handle, child, stderrLines })
       childLog.info({ pid: child.pid }, "spawn ok")
       return { ...handle, getStderr: () => [...stderrLines], child }
     }
     
     function notifyCrash(bridgeId: string, exitCode: number | null): void {
       for (const handler of crashHandlers) {
         try { handler(bridgeId, exitCode) } catch (e) {
           log.warn({ err: e, bridgeId }, "crash handler threw")
         }
       }
     }
     
     return {
       async spawn(bridgeId, input) { return spawnInternal(bridgeId, input) },
       async spawnWithStderr(bridgeId, input) { return spawnInternal(bridgeId, input) },
       
       get(bridgeId) { return store.get(bridgeId)?.handle ?? null },
       
       getChild(bridgeId) { return store.get(bridgeId)?.child ?? null },
       
       list() { return [...store.values()].map(e => e.handle) },
       
       async kill(bridgeId) {
         const entry = store.get(bridgeId)
         if (!entry) return false
         log.info({ bridgeId }, "kill")
         store.delete(bridgeId)  // לפני ה-exit event, מונע notifyCrash
         return new Promise<boolean>((resolve) => {
           entry.child.once("exit", () => resolve(true))
           entry.child.kill("SIGTERM")
           setTimeout(() => entry.child.kill("SIGKILL"), 5000)
         })
       },
       
       onCrash(handler) {
         crashHandlers.add(handler)
         return () => { crashHandlers.delete(handler) }
       },
     }
   }
   ```

5. עדכן `packages/backend/tests/bridge-manager.test.ts`:
   - ה-mock על `node:child_process` עדיין רלוונטי
   - הסר את ה-test ש-mock-ed stdout עם "Listening on ws://..." (אין יותר port parsing)
   - הוסף tests שמאמתים שspawn עם `pid=undefined` מטופל בלי uncaught
   - הוסף tests שמאמתים ש-`getChild()` מחזיר את ה-ChildProcess

**DoD:**
- `pnpm typecheck` ירוק
- `bridge-manager.test.ts` + `bridge-failure-modes.test.ts` עוברים
- ה-integration tests עדיין אדומים (ws-agent עוד לא הותאם)
- לוג ב-spawn: `spawn start` עם bin/cwd, `spawn ok` עם pid, `child exit` עם code

**Commit:** `refactor(backend): Phase 2 — bridge-manager עם spawn ישיר, ללא stdio-to-ws (slice 10 f1)`

---

### Phase 3 — WS-agent pipe (DIY) + orchestrator wiring

**Testing:** integration (ה-tests האדומים הופכים לירוקים)
**Verifier-phase:** אחרי ה-phase הזה, הfix אמור להיות שלם. הפעל verifier-phase.

**מטרה:** שכתוב של `ws-agent.ts` לחבר ישירות את ה-feWs (ws.WebSocket) אל ה-child מה-Map ב-bridge-manager. מימוש ה-`pipeChild` בפנים, ~30 שורות. ה-orchestrator נקרא עם שינוי API קטן.

**משימות:**

1. שכתוב `packages/backend/src/delivery/ws-agent.ts`:

   ```ts
   import { createInterface } from "node:readline"
   import { createLogger } from "@drive-coding/core/log"
   import type { WebSocket } from "ws"
   import type { AgentOrchestrator } from "../app/agent-orchestrator.js"
   import type { BridgeHandleWithStderr } from "../acp/bridge-manager.js"
   
   const log = createLogger("backend.ws.agent")
   
   export function createAgentWsHandler(deps: {
     orchestrator: AgentOrchestrator
     bridgeManager: { getChild(bridgeId: string): ChildProcessWithoutNullStreams | null }
   }): (ws: WebSocket, agentId: string) => void {
     // MED-8: one active FE WS per agentId
     const activeFeWs = new Map<string, WebSocket>()
     
     return function onConnect(feWs, agentId) {
       const childLog = log.child({ agentId })
       
       // MED-8 guard
       if (activeFeWs.has(agentId)) {
         childLog.warn({}, "second tab rejected")
         feWs.close(1008, "agent in use by another tab")
         return
       }
       
       const child = deps.bridgeManager.getChild(agentId)
       if (!child) {
         childLog.warn({}, "agent not found")
         feWs.close(1008, "agent not found")
         return
       }
       
       activeFeWs.set(agentId, feWs)
       childLog.info({ pid: child.pid }, "WS connect → pipe attached")
       
       // ── pipeChild ─────────────────────────────────────────────────────
       // child.stdout (NDJSON lines) → feWs.send
       child.stdout.setEncoding("utf8")
       const rl = createInterface({ input: child.stdout, crlfDelay: Infinity })
       rl.on("line", (line) => {
         if (line.length === 0) return
         try { feWs.send(line) } catch { /* feWs closing */ }
       })
       
       // feWs message → child.stdin (add newline if missing)
       feWs.on("message", (data) => {
         try {
           const text = data.toString()
           const line = text.endsWith("\n") ? text : `${text}\n`
           child.stdin.write(line)
         } catch (err) {
           childLog.warn({ err }, "stdin write failed")
         }
       })
       
       // child exit → close feWs
       const onChildExit = (code: number | null) => {
         childLog.info({ code }, "child exited — closing feWs")
         try { feWs.close(1011, "bridge closed") } catch {}
       }
       child.once("exit", onChildExit)
       
       // feWs close → cleanup, but do NOT kill child
       feWs.on("close", () => {
         childLog.info({}, "WS disconnect — detaching pipe")
         activeFeWs.delete(agentId)
         rl.close()
         child.off("exit", onChildExit)
         // החשוב: לא לקרוא ל-child.kill() — ה-child ממשיך לחיות, ה-FE הבא יכול להתחבר שוב
       })
     }
   }
   ```

2. ב-`packages/backend/src/server.ts`:
   - ב-upgrade handler, ל-`/ws/agent/:id`: חלץ את agentId מ-url, עשה `agentWss.handleUpgrade(req, socket, head, ws => onConnect(ws, agentId))`.

3. ב-`packages/backend/src/app/agent-orchestrator.ts`:
   - עדכן ל-`spawnWithStderr` החדש: ה-`handle` אין לו `port` משמעותי. בעצם, ה-`bridgePort` ב-`Agent` schema יכול להישאר 0 או להישמר (אחור-תאימות עם client old).
   - ה-`getBridgePort` יכול להישאר (מחזיר 0 או ה-pid).
   - ב-`createAndSpawn`: ה-`status: "spawning"` החזרה כבר לא מדויקת — ה-child כבר רץ. אבל ב-API החיצוני השאר את זה כפי שהוא כדי לא לשבור את ה-FE. ה-FE עדיין יעדכן ל-`ready` אחרי session-attached.

4. ב-`packages/backend/src/server.ts`, הgenerate של `createAgentWsHandler`:
   - צריך גם `bridgeManager` ל-deps — שדרג את ה-call ל-`createAgentWsHandler({ orchestrator, bridgeManager })`

5. עדכן `packages/backend/tests/ws-agent-pipe.test.ts`:
   - ה-test צריך לעבוד מול ה-API החדש: מ-Map של children, ws.WebSocket אמיתי, פיפ stdin/stdout.
   - ייתכן שיש ל-mock את ה-bridgeManager + לתת child mock עם stdin/stdout streams.

**DoD:**
- `pnpm typecheck` + `pnpm lint` ירוקים
- `pnpm test` בכל ה-packages ירוק
- **3 ה-integration tests ב-`bridge-failure-integration.test.ts` הופכים לירוקים** ← ה-DoD העיקרי
- 8 ה-unit tests ב-`bridge-failure-modes.test.ts` ממשיכים לעבור
- smoke ידני: הרם BE, POST /api/agents עובד, GET /api/agents/:id מחזיר סטטוס, DELETE מוחק
- לוג בWS open: `WS connect → pipe attached` עם pid

**Commit:** `fix(backend): Phase 3 — F-1 fix, in-process pipe, BE שורד spawn failures (slice 10 f1)`

**אחרי ה-commit הזה — הפעל verifier-phase על Phase 3.**

---

### Phase 4 — Defenses + cleanup + walkthrough

**Testing:** manual (לוגים + smoke)

**מטרה:** הוספת safety nets, וידוא שלא הותרנו זבל.

**משימות:**

1. ב-`packages/backend/src/server.ts` (בהתחלה, אחרי `log-setup.js` import):
   ```ts
   const procLog = createLogger("backend.process")
   
   process.on("uncaughtException", (err) => {
     procLog.error({ err: { name: err.name, message: err.message, stack: err.stack } }, "uncaughtException — exiting")
     process.exit(1)
   })
   
   process.on("unhandledRejection", (reason) => {
     procLog.error({ reason: String(reason) }, "unhandledRejection — exiting")
     process.exit(1)
   })
   ```

2. עבור על הקובץ `packages/backend/src/acp/cli-config.ts` — וודא ש-`buildStdioToWsArgs` נמחק.

3. עבור על `packages/backend/src/` ובדוק:
   - אין import של `bridge-spawn.js` (קובץ נמחק)
   - אין שימוש ב-`Bun.serve`, `Bun.write`, `Bun.file` או גלובלי Bun אחר
   - אין שימוש ב-`process.env.PORT` ב-cleanup_paths (נשאר רק ב-server.ts)

4. Update `docs/walkthrough.md` עם entry קצר בסוף:
   - תאריך, HEAD, מה השתנה (F-1 fix + הסרת Bun.serve), איך הtests נראים עכשיו.

5. Update `docs/behaviors-coverage.md` (אם קיים) — לסמן שF-1 טופל.

**DoD:**
- `pnpm typecheck` + `pnpm lint` + `pnpm test` ירוקים
- אין אזכור ל-`bridge-spawn`, `stdio-to-ws`, או `buildStdioToWsArgs` בקוד
- אין אזכור ל-`Bun.serve` או גלובלי-Bun ב-src/
- walkthrough מעודכן

**Commit:** `chore(backend): Phase 4 — uncaught handlers + cleanup + walkthrough (slice 10 f1)`

---

## 8. DoD סופי ל-slice

- [ ] 4 phases הושלמו עם commits בפורמט עברית
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm test` ירוקים
- [ ] **3 tests ב-`bridge-failure-integration.test.ts` ירוקים** (היו אדומים ב-3412f1b)
- [ ] 8 tests ב-`bridge-failure-modes.test.ts` ממשיכים לעבור
- [ ] כל ה-tests האחרים (298 ב-BE, 167 ב-FE) ממשיכים לעבור
- [ ] הרצה ידנית: BE עולה, FE מתחבר, יוצר agent, שולח prompt, מקבל תשובה (קצה לקצה)
- [ ] BE שורד POST עם cwd פגום (curl ל-/api/agents עם cwd=/nonexistent, אז curl ל-/api/health)
- [ ] BE שורד POST עם PATH ריק (ה-test האוטומטי מכסה)
- [ ] ה-walkthrough עודכן

---

## 9. Verifier instructions

**Verifier-phase אחרי Phase 3** (executor מפעיל):
- סקופ מצומצם: ה-3 integration tests ירוקים? ה-FE עדיין מתחבר ויוצר agent? BE לא עף כשמזרקים לו input פגום?
- 10-15 דקות
- אם יש באג: STOP → פנייה לאבי, לא תקן לבד.

**Verifier-slice-heavy בסוף** (אבי מפעיל):
- הפרוטוקול המלא: walk DoD, edge cases, regressions, side flows
- בודק:
  - FE שלם (dashboard, agent page, prompt, response, sessions)
  - reload מצליח (לא מתקיים F-1 באמצע)
  - ניווט ל-/session/INVALID — BE שורד (F-1/F-2 retest)
  - Multi-tab עדיין עובד (MED-8 retest)
  - בקרה לתפקוד ה-/proxy (unaffected)

---

## 10. אסור / מותר

**מותר:**
- `packages/backend/src/**` (refactor מלא)
- `packages/backend/tests/**` (עדכון tests ל-API החדש, אבל לא למחוק את ה-2 ה-failure-* קבצים החדשים)
- `packages/backend/package.json` (הוספת @hono/node-server)
- `docs/walkthrough.md` (entry בסוף)

**אסור:**
- FE בכלל (`packages/frontend/**`)
- `packages/core/**` (חוץ מ-types אם באמת הכרחי, ובדיון ראשון)
- `docs/slice-10-exploratory-test-report.md` (source of truth)
- `docs/slice-10-f1-fix-brief.md` (זה הקובץ הזה, source of truth ל-slice)
- ה-fork ב-`~/vendor/stdio-to-ws` (לא לגעת — אבי החליט)
- push ל-remote

---

## 11. סקילים חובה ל-executor

- `tdd` — phase 2 הוא tdd, phase 3 הוא integration
- `dev-conventions` — ESM, Svelte conventions (לא רלוונטי פה אבל טוב לזכור), no any
- `commit` — פר phase, עברית
- `update-walkthrough` — בPhase 4

---

## 12. Prompt לסוכן executor

```
אתה executor של Slice 10 F-1 Fix.
ה-brief המלא ב-`docs/slice-10-f1-fix-brief.md` — זה source of truth.

נתיבים:
- worktree: /home/user/projects/voice-acp-v3
- branch: vnext-fe-orchestrated
- HEAD בסיס: 3412f1b

הקשר:
- ה-bug F-1 מתועד ב-`docs/slice-10-exploratory-test-report.md`
- ה-3 integration tests האדומים: `packages/backend/tests/bridge-failure-integration.test.ts`
- ה-8 unit tests הירוקים: `packages/backend/tests/bridge-failure-modes.test.ts`

הוראות:
1. טען skills: tdd, dev-conventions, commit
2. קרא את ה-brief מקצה לקצה
3. בצע Phase 1 → 2 → 3 → 4 בסדר
4. commit פר phase, עברית, פורמט לפי ה-brief
5. אחרי Phase 3 — הפעל verifier-phase
6. סיים ב-Phase 4 עם walkthrough update

tmux פעיל:
- be-v3 (port 4000, OneCLI agent voice-acp)
- fe-v3 (port 5174)
- tunnel-v3 https://your-app-v3.nue.tuns.sh

אם tmux מת — הרם מחדש (הפקודות ב-`docs/slice-10-exploratory-test-report.md`).

אסור:
- לגעת ב-FE
- לגעת ב-fork (~/vendor/stdio-to-ws)
- push ל-remote
- לסטות מ-testing strategy שצוין פר phase

אם החלטה ארכיטקטונית לא מכוסה ב-brief — STOP ושאל את אבי דרך parent task.
אחרת — אוטונומיה מלאה.
```
