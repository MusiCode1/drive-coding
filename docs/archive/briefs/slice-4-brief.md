# Slice 4 — Implementation Brief

> **מטרה:** AcpTransport — backend מתחבר ל-bridge WS, עושה ACP handshake, מבצע session/prompt. frontend מציג chat טקסטואלי על `/agent/:id` (אין voice).
> **תלות:** Slice 3 (✅ commit `2958687`).
> **המתחיל:** Yolo executor (Sonnet 4-6).

---

## 1. החלטות שננעלו ל-Slice 4

| נושא | בחירה |
|------|--------|
| **SDK** | `@agentclientprotocol/sdk` — `ClientSideConnection` (D24/D33) |
| **WS client** | `ws` package (universal Node+Bun) |
| **Streams adapter** | adapter שמתרגם בין `ws.WebSocket` ל-`ReadableStream`/`WritableStream` שה-SDK מצפה להם |
| **FE↔BE protocol** | drive-coding-ws — תת-קבוצה מ-vnext-spec §3 (text events בלבד ב-Slice 4) |
| **Tests** | D49 — `@agentclientprotocol/sdk/src/examples/agent.ts` כ-mock agent. spawn ו-loopback patterns |
| **Smoke E2E** | spawn opencode אמיתי דרך BridgeManager, send prompt, קבל chunks ב-WS, הצג ב-frontend |
| **Cancel** | `session/cancel` מ-CLIENT — Slice 4 לא חובה (Slice 5/7 — drive UX). בסיס בלבד |
| **Permissions** | ACP `requestPermission` — auto-deny מ-`-32601 method not found` ב-Slice 4. מאוחר נחבר UI |

---

## 2. מה נוסף

### 2.1 Core schemas

**עדכון** `packages/core/src/schemas/ws-messages.ts`:
- הוסף `text_chunk`, `thinking`, `tool_call`, `done`, `error` ל-ServerMessage.
- הוסף `prompt`, `cancel` ל-ClientMessage.

### 2.2 Core acp

**חדש** `packages/core/src/acp/`:
- `provider-error.ts` — port from POC (`extractProviderError`).
- `sentence-boundary.ts` — port from POC (לא לפעם זה — Slice 5 ישתמש).

### 2.3 Core ports

**עדכון** `packages/core/src/ports.ts`:
- הוסף `AcpTransport` interface.

### 2.4 Backend acp

**חדש**:
- `packages/backend/src/acp/ws-streams.ts` — Adapter בין `ws.WebSocket` ל-Web Streams.
- `packages/backend/src/acp/acp-transport.ts` — wraps `ClientSideConnection`.
- `packages/backend/src/acp/client-impl.ts` — implementations של callbacks ל-`requestPermission`, `fs/*`, `terminal/*` (כולם `-32601 method not found` מלבד agent-only methods).

**עדכון**:
- `agent-orchestrator.ts`: אחרי spawn, גם ל-`attach` ל-bridge (initialize + session/new).
- `server.ts`: wire AcpTransport.

### 2.5 Backend delivery

**חדש**:
- `packages/backend/src/delivery/ws-agent.ts` — WS handler ל-`/ws/agent/:id`. ראה §3.4.

### 2.6 Backend app

**חדש**:
- `packages/backend/src/app/agent-session.ts` — `AgentSession` שמחזיק AcpTransport per agent + broadcast events ל-WS subscribers.

### 2.7 Frontend

**עדכון**:
- `packages/frontend/src/routes/agent/[id]/+page.svelte` — chat UI עם text input + chat bubbles.
- `packages/frontend/src/lib/stores/agent-session.ts` — store עם WS connection ל-`/ws/agent/:id`.

---

## 3. תבניות קוד מדויקות

### 3.1 `packages/core/src/schemas/ws-messages.ts` (הרחבה)

ה-`PingMessage`/`PongMessage` קיים מ-Slice 1. הוסף:

```typescript
import { type } from "arktype"

// Client → Server (קיים: ping)
export const PingMessage = type({ type: "'ping'" })

// חדש ב-Slice 4
export const PromptMessage = type({
  type: "'prompt'",
  text: "string >= 1",
})

export const CancelMessage = type({ type: "'cancel'" })

export const ClientMessage = PingMessage.or(PromptMessage).or(CancelMessage)
export type ClientMessage = typeof ClientMessage.infer

// Server → Client
export const HelloMessage = type({ type: "'hello'", version: "string" })
export const PongMessage = type({
  type: "'pong'",
  echoOf: "string",
  serverTime: "number",
})

// חדש ב-Slice 4
export const ConnectedMessage = type({
  type: "'connected'",
  agentId: "string.uuid",
})

export const ThinkingMessage = type({
  type: "'thinking'",
})

export const TextChunkMessage = type({
  type: "'text_chunk'",
  kind: "'message' | 'thought'",
  text: "string",
})

export const ToolCallMessage = type({
  type: "'tool_call'",
  toolCallId: "string",
  title: "string",
})

export const DoneMessage = type({
  type: "'done'",
  stopReason: "string",
})

export const ErrorMessage = type({
  type: "'error'",
  code: "string",
  message: "string",
})

export const ServerMessage = HelloMessage
  .or(PongMessage)
  .or(ConnectedMessage)
  .or(ThinkingMessage)
  .or(TextChunkMessage)
  .or(ToolCallMessage)
  .or(DoneMessage)
  .or(ErrorMessage)

export type ServerMessage = typeof ServerMessage.infer
```

### 3.2 `packages/core/src/ports.ts` (הוסף AcpTransport)

```typescript
// קיים: AgentRegistry, BridgeManager

// ─── ACP Transport (חדש ב-Slice 4) ──────────────────────────

export type AcpCapabilities = {
  readonly loadSession: boolean
}

export type AcpError =
  | { readonly kind: "transport"; readonly message: string }
  | { readonly kind: "protocol"; readonly message: string }
  | { readonly kind: "agent"; readonly message: string }

// re-export מ-SDK
export type { SessionNotification, PromptResponse } from "@agentclientprotocol/sdk"

import type { SessionNotification, PromptResponse } from "@agentclientprotocol/sdk"

export interface AcpTransport {
  /** Connect + initialize + (optionally) session/new. */
  start(input: { readonly cwd: string }): Promise<{ readonly sessionId: string; readonly capabilities: AcpCapabilities }>

  /** Send prompt. onUpdate נקרא לכל session/update. */
  prompt(
    input: { readonly text: string },
    onUpdate: (n: SessionNotification) => void,
  ): Promise<PromptResponse>

  /** Cancel in-flight prompt. */
  cancel(): Promise<void>

  /** Disconnect WS, leave the bridge alive. */
  shutdown(): Promise<void>
}
```

### 3.3 `packages/backend/src/acp/ws-streams.ts` (Adapter)

```typescript
import type { WebSocket } from "ws"

/**
 * Convert ws.WebSocket → ReadableStream<Uint8Array> + WritableStream<Uint8Array>
 * שה-SDK של ACP מצפה להם ב-ClientSideConnection.
 *
 * המסר ב-ws.WebSocket הוא frame בודד. ACP מצפה ל-NDJSON על stream.
 * אז אנחנו עוטפים כל message בtypedArray + appending newline.
 */
export function wsToStreams(ws: WebSocket): {
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<Uint8Array>
} {
  const encoder = new TextEncoder()

  // Readable — read incoming messages
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      ws.on("message", (data: Buffer | string) => {
        const text = typeof data === "string" ? data : data.toString("utf8")
        // ACP NDJSON — וודא newline בסוף
        const line = text.endsWith("\n") ? text : `${text}\n`
        controller.enqueue(encoder.encode(line))
      })
      ws.on("close", () => {
        try {
          controller.close()
        } catch {
          // already closed
        }
      })
      ws.on("error", (err) => {
        try {
          controller.error(err)
        } catch {
          // already errored
        }
      })
    },
  })

  // Writable — write outgoing messages
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      // ACP frame הוא NDJSON. stdio-to-ws עושה line framing.
      // chunk יכול לכלול מספר שורות. שלח כל אחת כ-WS frame.
      const text = new TextDecoder().decode(chunk)
      for (const line of text.split("\n")) {
        if (line.trim().length > 0) {
          ws.send(line)
        }
      }
    },
    close() {
      if (ws.readyState === ws.OPEN) {
        ws.close()
      }
    },
    abort(reason) {
      if (ws.readyState === ws.OPEN) {
        ws.close(1011, String(reason))
      }
    },
  })

  return { readable, writable }
}
```

### 3.4 `packages/backend/src/acp/client-impl.ts` (חדש)

```typescript
import type { ClientSideConnection } from "@agentclientprotocol/sdk"

/**
 * ה-callbacks שה-SDK של ACP מצפה לקבל מהClient ל-Agent.
 * רוב המתודות לא נתמכות ב-Slice 4 — נחזיר Method not found.
 *
 * הסוג של ה-client implementation:
 * - requestPermission: ה-CLI מבקש אישור על pre-permitted action. ב-Slice 4 — auto-allow_once.
 * - fs/* : הCLI מבקש לקרוא/לכתוב קבצים דרכנו. ב-Slice 4 — לא תומכים.
 * - terminal/* : הCLI מבקש פתיחת terminal. ב-Slice 4 — לא תומכים.
 */
export function createClientImpl(): NonNullable<ConstructorParameters<typeof ClientSideConnection>[2]> {
  return {
    async requestPermission(_req) {
      // Slice 4: auto-allow_once. Slice 5+: forward ל-UI.
      // החזר אופציה ראשונה כאם היא 'allow_once'
      return { outcome: { outcome: "selected", optionId: "allow_once" } }
    },

    async sessionUpdate(_notification) {
      // נקרא לכל session/update. ה-AcpTransport מעביר ל-onUpdate callback.
      // ה-implementation האמיתי ב-acp-transport.ts.
    },

    // אופציונליים — לא נתמכים ב-Slice 4
    // (writeTextFile, readTextFile, createTerminal, וכו') — נטפל ב-future
  }
}
```

> **הערה:** ה-API של `ClientSideConnection` קצת תלוי בגרסת ה-SDK. בדוק את הtypes באמצעות:
> ```bash
> bun add @agentclientprotocol/sdk
> grep -r "ClientSideConnection" node_modules/@agentclientprotocol/sdk/dist/*.d.ts | head -5
> ```
> ייתכן ש-`sessionUpdate` ו-`requestPermission` יוגדרו ב-interface אחר. התאם.

### 3.5 `packages/backend/src/acp/acp-transport.ts` (חדש)

```typescript
import { ClientSideConnection } from "@agentclientprotocol/sdk"
import { WebSocket } from "ws"
import type {
  AcpCapabilities,
  AcpTransport,
  SessionNotification,
  PromptResponse,
} from "@drive-coding/core"
import { wsToStreams } from "./ws-streams"

export type AcpTransportOptions = {
  readonly wsUrl: string                   // ws://127.0.0.1:<port>/
  readonly cwd: string
  readonly protocolVersion?: number        // default 1
}

/**
 * AcpTransport מעל ws connection ל-stdio-to-ws bridge.
 * 
 * Lifecycle:
 *   start() → ws connect → initialize → (newSession | loadSession)
 *   prompt(text, onUpdate) → session/prompt
 *   cancel() → session/cancel
 *   shutdown() → ws close
 */
export async function createAcpWsTransport(opts: AcpTransportOptions): Promise<AcpTransport> {
  return new Promise(async (resolve, reject) => {
    const ws = new WebSocket(opts.wsUrl)

    let sessionId: string | null = null
    let capabilities: AcpCapabilities | null = null
    let onUpdateHandler: ((n: SessionNotification) => void) | null = null

    ws.on("open", async () => {
      try {
        const { readable, writable } = wsToStreams(ws)

        // ה-SDK של ACP — ClientSideConnection מקבל streams + client implementation
        const conn = new ClientSideConnection(readable, writable, {
          async sessionUpdate(notification) {
            onUpdateHandler?.(notification)
          },
          async requestPermission(_req) {
            return { outcome: { outcome: "selected", optionId: "allow_once" } }
          },
        })

        const initResult = await conn.initialize({
          protocolVersion: opts.protocolVersion ?? 1,
          clientCapabilities: {},
        })

        capabilities = {
          loadSession: initResult.agentCapabilities?.loadSession ?? false,
        }

        const sessionResult = await conn.newSession({
          cwd: opts.cwd,
          mcpServers: [],
        })

        sessionId = sessionResult.sessionId

        // החזר את ה-transport
        const transport: AcpTransport = {
          async start(_input) {
            if (!sessionId || !capabilities) {
              throw new Error("Transport not initialized")
            }
            return { sessionId, capabilities }
          },

          async prompt(input, onUpdate) {
            if (!sessionId) throw new Error("No session")
            onUpdateHandler = onUpdate
            try {
              const response = await conn.prompt({
                sessionId,
                prompt: [{ type: "text", text: input.text }],
              })
              return response
            } finally {
              onUpdateHandler = null
            }
          },

          async cancel() {
            if (!sessionId) return
            await conn.cancel({ sessionId })
          },

          async shutdown() {
            if (ws.readyState === ws.OPEN) {
              ws.close()
            }
          },
        }

        resolve(transport)
      } catch (e) {
        reject(e)
      }
    })

    ws.on("error", (err) => {
      reject(new Error(`WS connection failed: ${err.message}`))
    })

    // Timeout — 10 שניות לחיבור + handshake
    setTimeout(() => {
      if (ws.readyState !== ws.OPEN) {
        ws.close()
        reject(new Error("WS connection timeout"))
      }
    }, 10000)
  })
}
```

> **תלוי בגרסת SDK** — ה-method `prompt` של `ClientSideConnection` יכול לקבל שדות שונים. ה-`prompt: [{ type: "text", text }]` הוא ה-format החדש ב-v0.21. אם ה-SDK שלך שונה, התאם.

### 3.6 `packages/backend/src/app/agent-session.ts` (חדש)

```typescript
import type { AcpTransport, SessionNotification, ServerMessage } from "@drive-coding/core"

export type Subscriber = (msg: ServerMessage) => void

/**
 * AgentSession מחזיק AcpTransport + רשימת WS subscribers (multi-tab).
 * כל subscriber מקבל את כל ה-events.
 */
export type AgentSession = {
  readonly agentId: string
  readonly subscribe: (cb: Subscriber) => () => void
  readonly sendPrompt: (text: string) => Promise<void>
  readonly cancel: () => Promise<void>
  readonly shutdown: () => Promise<void>
}

export function createAgentSession(opts: {
  agentId: string
  transport: AcpTransport
}): AgentSession {
  const subscribers = new Set<Subscriber>()

  function broadcast(msg: ServerMessage): void {
    for (const sub of subscribers) {
      try {
        sub(msg)
      } catch (e) {
        console.error("[agent-session] subscriber threw:", e)
      }
    }
  }

  return {
    agentId: opts.agentId,
    subscribe(cb) {
      subscribers.add(cb)
      return () => subscribers.delete(cb)
    },

    async sendPrompt(text) {
      broadcast({ type: "thinking" })

      try {
        const response = await opts.transport.prompt({ text }, (notification) => {
          // Translate SessionNotification → ServerMessage
          // ה-notification.update הוא union — בדוק את ה-kind
          // SDK v0.21: { sessionId, update: { sessionUpdate: "...", ... } }
          const update = (notification as any).update

          if (!update) return

          switch (update.sessionUpdate) {
            case "agent_message_chunk":
              if (update.content?.type === "text") {
                broadcast({
                  type: "text_chunk",
                  kind: "message",
                  text: update.content.text,
                })
              }
              break
            case "agent_thought_chunk":
              if (update.content?.type === "text") {
                broadcast({
                  type: "text_chunk",
                  kind: "thought",
                  text: update.content.text,
                })
              }
              break
            case "tool_call":
              broadcast({
                type: "tool_call",
                toolCallId: update.toolCallId,
                title: update.title ?? "(no title)",
              })
              break
            // אחרים — שקט ב-Slice 4
          }
        })

        broadcast({
          type: "done",
          stopReason: response.stopReason ?? "end_turn",
        })
      } catch (e) {
        broadcast({
          type: "error",
          code: "PROMPT_FAILED",
          message: e instanceof Error ? e.message : String(e),
        })
      }
    },

    async cancel() {
      await opts.transport.cancel()
    },

    async shutdown() {
      await opts.transport.shutdown()
    },
  }
}
```

### 3.7 `packages/backend/src/app/agent-orchestrator.ts` (עדכון)

ה-orchestrator עכשיו גם יוצר AcpTransport + AgentSession אחרי שה-bridge עלה:

```typescript
import type {
  AgentRegistry,
  BridgeManager,
  CreateAgentInput,
  Agent,
} from "@drive-coding/core"
import { createAcpWsTransport } from "../acp/acp-transport"
import { createAgentSession, type AgentSession } from "./agent-session"

export type AgentOrchestrator = {
  createAndSpawn(input: CreateAgentInput): Promise<Agent>
  deleteAndKill(id: string): Promise<void>
  getSession(id: string): AgentSession | null
}

export function createAgentOrchestrator(deps: {
  registry: AgentRegistry
  bridgeManager: BridgeManager
}): AgentOrchestrator {
  const sessions = new Map<string, AgentSession>()

  deps.bridgeManager.onCrash(async (bridgeId, exitCode) => {
    try {
      const existing = await deps.registry.get(bridgeId)
      if (existing && existing.status !== "closed") {
        await deps.registry.update(bridgeId, { status: "crashed" })
      }
      const session = sessions.get(bridgeId)
      if (session) {
        await session.shutdown().catch(() => {})
        sessions.delete(bridgeId)
      }
      console.warn(`[orchestrator] bridge ${bridgeId} crashed with code ${exitCode}`)
    } catch (e) {
      console.error("[orchestrator] crash cleanup failed:", e)
    }
  })

  return {
    async createAndSpawn(input) {
      const agent = await deps.registry.create(input)
      await deps.registry.update(agent.id, { status: "starting" })

      try {
        const handle = await deps.bridgeManager.spawn(agent.id, {
          cliKind: input.cliKind,
          cwd: input.cwd,
          modelOverride: input.modelOverride ?? null,
        })

        // חדש ב-Slice 4: ACP handshake
        const transport = await createAcpWsTransport({
          wsUrl: handle.wsUrl,
          cwd: input.cwd,
        })
        const session = await transport.start({ cwd: input.cwd })
        const agentSession = createAgentSession({ agentId: agent.id, transport })
        sessions.set(agent.id, agentSession)

        const updated = await deps.registry.update(agent.id, {
          status: "ready",
          bridgePort: handle.port,
          acpSessionId: session.sessionId,
        })
        return updated
      } catch (e) {
        await deps.registry.update(agent.id, { status: "crashed" }).catch(() => {})
        throw new Error(`spawn/attach failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    },

    async deleteAndKill(id) {
      const agent = await deps.registry.get(id)
      if (!agent) return

      await deps.registry.update(id, { status: "closed" }).catch(() => {})

      const session = sessions.get(id)
      if (session) {
        await session.shutdown().catch(() => {})
        sessions.delete(id)
      }

      await deps.bridgeManager.kill(id)
      await deps.registry.delete(id).catch(() => {})
    },

    getSession(id) {
      return sessions.get(id) ?? null
    },
  }
}
```

### 3.8 `packages/backend/src/delivery/ws-agent.ts` (חדש)

```typescript
import type { Hono } from "hono"
import type { ServerWebSocket } from "bun"
import { type } from "arktype"
import { ClientMessage, type ServerMessage } from "@drive-coding/core"
import type { AgentOrchestrator } from "../app/agent-orchestrator"

type WsData = {
  agentId: string
  unsubscribe?: () => void
}

function send(ws: ServerWebSocket<WsData>, msg: ServerMessage): void {
  try {
    ws.send(JSON.stringify(msg))
  } catch {
    // ws closed
  }
}

export function registerAgentWs(
  _app: Hono,
  deps: { orchestrator: AgentOrchestrator },
): {
  websocket: Parameters<typeof Bun.serve<WsData>>[0]["websocket"]
  upgradeHandler: (
    req: Request,
    server: ReturnType<typeof Bun.serve<WsData>>,
  ) => Response | undefined
} {
  return {
    websocket: {
      open(ws) {
        const agentId = ws.data.agentId
        const session = deps.orchestrator.getSession(agentId)
        if (!session) {
          send(ws, { type: "error", code: "AGENT_NOT_FOUND", message: agentId })
          ws.close(1008, "agent not found")
          return
        }

        send(ws, { type: "connected", agentId })

        ws.data.unsubscribe = session.subscribe((msg) => send(ws, msg))
      },

      async message(ws, raw) {
        let parsed: unknown
        try {
          parsed = JSON.parse(String(raw))
        } catch {
          send(ws, { type: "error", code: "INVALID_JSON", message: "invalid json" })
          return
        }

        const result = ClientMessage(parsed)
        if (result instanceof type.errors) {
          send(ws, { type: "error", code: "INVALID_MSG", message: result.summary })
          return
        }

        const session = deps.orchestrator.getSession(ws.data.agentId)
        if (!session) {
          send(ws, { type: "error", code: "AGENT_NOT_FOUND", message: ws.data.agentId })
          return
        }

        switch (result.type) {
          case "ping":
            send(ws, { type: "pong", echoOf: "ping", serverTime: Date.now() })
            break
          case "prompt":
            // fire & forget — broadcasting via subscriber
            session.sendPrompt(result.text).catch((e) => {
              console.error("[ws-agent] prompt failed:", e)
            })
            break
          case "cancel":
            await session.cancel().catch((e) => {
              console.error("[ws-agent] cancel failed:", e)
            })
            break
        }
      },

      close(ws) {
        ws.data.unsubscribe?.()
      },
    },

    upgradeHandler(req, server) {
      const url = new URL(req.url)
      const match = url.pathname.match(/^\/ws\/agent\/([^/]+)$/)
      if (!match) return undefined

      const agentId = match[1]!
      const upgraded = server.upgrade(req, {
        data: { agentId } satisfies WsData,
      })
      if (upgraded) return undefined
      return new Response("WS upgrade failed", { status: 426 })
    },
  }
}
```

### 3.9 `packages/backend/src/server.ts` (עדכון)

```typescript
import { Hono } from "hono"
import { cors } from "hono/cors"
import { createInMemoryAgentRegistry } from "./agents/registry"
import { createBridgeManager } from "./acp/bridge-manager"
import { createAgentOrchestrator } from "./app/agent-orchestrator"
import { registerHttp } from "./delivery/http"
import { registerAgentsHttp } from "./delivery/http-agents"
import { registerEchoWs } from "./delivery/ws-echo"
import { registerAgentWs } from "./delivery/ws-agent"

const app = new Hono()
app.use("*", cors({ origin: ["http://localhost:5173"], credentials: true }))

const registry = createInMemoryAgentRegistry()
const bridgeManager = createBridgeManager()
const orchestrator = createAgentOrchestrator({ registry, bridgeManager })

registerHttp(app)
registerAgentsHttp(app, { registry, orchestrator })

const echo = registerEchoWs(app)
const agentWs = registerAgentWs(app, { orchestrator })

const port = Number(process.env.PORT ?? 4000)

const server = Bun.serve({
  port,
  fetch: (req, server) => {
    const url = new URL(req.url)
    if (url.pathname === "/ws/echo") {
      const upgraded = server.upgrade(req)
      if (upgraded) return
      return new Response("WS upgrade failed", { status: 426 })
    }
    if (url.pathname.startsWith("/ws/agent/")) {
      return agentWs.upgradeHandler(req, server) ?? app.fetch(req)
    }
    return app.fetch(req)
  },
  websocket: {
    ...echo.websocket,
    ...agentWs.websocket,
    // אם יש collision, אצטרך router פנימי. ב-Bun.serve.websocket אין routing builtin — להתאים לפי ws.data.
  },
})

console.log(`[backend] listening on http://localhost:${port}`)
```

> **בעיה ידועה:** `Bun.serve.websocket` הוא handler אחד, לא מספר. אצטרך לאחד לhandler יחיד שמפיץ לפי `ws.data.agentId` או דגל אחר. ב-Slice 4 בעיה — נראה מה Yolo בוחר. אופציה: לאחד את כל ה-WS handlers בקובץ אחד (`ws-router.ts`) שמפיץ לפי `ws.data.kind`.

### 3.10 Frontend — chat UI

ה-`/agent/:id` route מתעדכן לעם chat text. אכלול כאן רק את החלקים החדשים — שאר ה-UI מ-Slice 2 נשאר.

`packages/frontend/src/lib/stores/agent-session.ts`:

```typescript
import type { ServerMessage } from "@drive-coding/core"

export type ChatMessage = {
  id: string
  kind: "user" | "assistant" | "thought" | "tool_call"
  text: string
  isStreaming?: boolean
}

export type AgentSessionStore = {
  messages: ChatMessage[]
  status: "disconnected" | "connecting" | "connected" | "thinking"
  error: string | null
  connect: () => void
  disconnect: () => void
  sendPrompt: (text: string) => void
  cancel: () => void
}

export function createAgentSessionStore(agentId: string): AgentSessionStore {
  let messages = $state<ChatMessage[]>([])
  let status = $state<AgentSessionStore["status"]>("disconnected")
  let error = $state<string | null>(null)
  let ws: WebSocket | null = null

  function appendChunk(kind: ChatMessage["kind"], text: string): void {
    const last = messages[messages.length - 1]
    if (last && last.kind === kind && last.isStreaming) {
      messages = [
        ...messages.slice(0, -1),
        { ...last, text: last.text + text },
      ]
    } else {
      messages = [
        ...messages,
        {
          id: crypto.randomUUID(),
          kind,
          text,
          isStreaming: true,
        },
      ]
    }
  }

  function finalizeStreaming(): void {
    messages = messages.map((m) =>
      m.isStreaming ? { ...m, isStreaming: false } : m,
    )
  }

  function handle(raw: string): void {
    try {
      const msg = JSON.parse(raw) as ServerMessage
      switch (msg.type) {
        case "connected":
          status = "connected"
          break
        case "thinking":
          status = "thinking"
          break
        case "text_chunk":
          appendChunk(msg.kind === "message" ? "assistant" : "thought", msg.text)
          break
        case "tool_call":
          messages = [
            ...messages,
            {
              id: crypto.randomUUID(),
              kind: "tool_call",
              text: msg.title,
            },
          ]
          break
        case "done":
          finalizeStreaming()
          status = "connected"
          break
        case "error":
          error = `${msg.code}: ${msg.message}`
          status = "connected"
          break
      }
    } catch (e) {
      error = `parse error: ${e}`
    }
  }

  return {
    get messages() { return messages },
    get status() { return status },
    get error() { return error },

    connect() {
      if (ws) return
      status = "connecting"
      error = null
      ws = new WebSocket(`ws://${location.host}/ws/agent/${agentId}`)
      ws.onmessage = (e) => handle(String(e.data))
      ws.onerror = () => {
        error = "WS error"
        status = "disconnected"
      }
      ws.onclose = () => {
        status = "disconnected"
        ws = null
      }
    },

    disconnect() {
      ws?.close()
      ws = null
      status = "disconnected"
    },

    sendPrompt(text) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        kind: "user",
        text,
      }
      messages = [...messages, userMsg]
      ws.send(JSON.stringify({ type: "prompt", text }))
    },

    cancel() {
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify({ type: "cancel" }))
    },
  }
}
```

`packages/frontend/src/routes/agent/[id]/+page.svelte` — chat UI שלם:

```svelte
<script lang="ts">
  import { page } from "$app/state"
  import { onDestroy } from "svelte"
  import type { AgentPublic } from "@drive-coding/core"
  import { getAgent } from "$lib/api/agents"
  import { createAgentSessionStore } from "$lib/stores/agent-session"

  let agentId = $derived(page.params.id!)
  let agent = $state<AgentPublic | null>(null)
  let loadError = $state<string | null>(null)

  let session = $derived(createAgentSessionStore(agentId))
  let input = $state("")

  async function loadAgent(): Promise<void> {
    try {
      const { agent: fetched } = await getAgent(agentId)
      agent = fetched
      if (fetched.status === "ready" && session.status === "disconnected") {
        session.connect()
      }
    } catch (e) {
      loadError = e instanceof Error ? e.message : "טעינה נכשלה"
    }
  }

  $effect(() => {
    if (agentId) loadAgent()
  })

  onDestroy(() => session.disconnect())

  function send(): void {
    if (!input.trim()) return
    session.sendPrompt(input.trim())
    input = ""
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }
</script>

<main>
  <header>
    <a href="/" class="back">← Dashboard</a>
    {#if agent}
      <span class="title">{agent.cliKind} · <code>{agent.cwd}</code></span>
      <span class="status status-{session.status}">{session.status}</span>
    {/if}
  </header>

  {#if loadError}
    <p class="error">{loadError}</p>
  {/if}

  <ul class="chat">
    {#each session.messages as msg (msg.id)}
      <li class="msg msg-{msg.kind}">
        <span class="bubble" dir="auto">{msg.text}</span>
      </li>
    {/each}
    {#if session.status === "thinking"}
      <li class="msg msg-assistant"><span class="bubble thinking">חושב...</span></li>
    {/if}
  </ul>

  {#if session.error}
    <p class="error">{session.error}</p>
  {/if}

  <form onsubmit={(e) => { e.preventDefault(); send() }}>
    <textarea
      bind:value={input}
      onkeydown={onKey}
      placeholder="הקלד הודעה..."
      rows="2"
      disabled={session.status !== "connected"}
    ></textarea>
    <button type="submit" disabled={!input.trim() || session.status !== "connected"}>שלח</button>
    {#if session.status === "thinking"}
      <button type="button" onclick={session.cancel}>בטל</button>
    {/if}
  </form>
</main>

<style>
  main { max-width: 720px; margin: 1rem auto; padding: 0 1rem; display: flex; flex-direction: column; height: 95vh; }
  header { display: flex; gap: 1rem; align-items: center; padding-bottom: 1rem; border-bottom: 1px solid #e5e7eb; }
  .back { color: #6b7280; text-decoration: none; }
  .title { font-weight: 600; }
  .status { padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.85rem; }
  .status-connected { background: #d1fae5; color: #065f46; }
  .status-connecting { background: #dbeafe; color: #1e40af; }
  .status-thinking { background: #fef3c7; color: #92400e; }
  .status-disconnected { background: #f3f4f6; color: #4b5563; }
  .chat { list-style: none; padding: 1rem 0; flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 0.5rem; }
  .msg { display: flex; }
  .msg-user { justify-content: flex-start; }
  .msg-assistant { justify-content: flex-end; }
  .msg-thought { justify-content: flex-end; opacity: 0.7; }
  .msg-tool_call { justify-content: center; }
  .bubble { background: #f3f4f6; padding: 0.6rem 1rem; border-radius: 12px; max-width: 70%; white-space: pre-wrap; word-wrap: break-word; }
  .msg-user .bubble { background: #2563eb; color: white; }
  .msg-thought .bubble { background: transparent; border: 1px dashed #d1d5db; font-style: italic; }
  .msg-tool_call .bubble { background: #fef3c7; font-size: 0.85rem; }
  .bubble.thinking { color: #6b7280; }
  .error { color: #b91c1c; background: #fef2f2; padding: 0.6rem; border-radius: 6px; margin: 0.5rem 0; }
  form { display: flex; gap: 0.5rem; padding-top: 1rem; border-top: 1px solid #e5e7eb; }
  textarea { flex: 1; padding: 0.6rem; border: 1px solid #d1d5db; border-radius: 6px; font-family: inherit; resize: none; font-size: 1rem; }
  textarea:focus { outline: none; border-color: #2563eb; }
  button { padding: 0.6rem 1.2rem; border: none; border-radius: 6px; background: #2563eb; color: white; font-weight: 600; cursor: pointer; }
  button:disabled { background: #9ca3af; cursor: not-allowed; }
</style>
```

---

## 4. Step-by-step

1. `cd /home/user/projects/voice-acp-v2`
2. **Install SDK:** `pnpm --filter @drive-coding/backend add @agentclientprotocol/sdk ws @types/ws`
3. **Core schemas:** עדכן `packages/core/src/schemas/ws-messages.ts` (§3.1)
4. **Core ports:** הוסף AcpTransport ל-`packages/core/src/ports.ts` (§3.2)
5. **`pnpm typecheck`** — אמור לעבור
6. **Backend acp:**
   - `acp/ws-streams.ts` (§3.3)
   - `acp/client-impl.ts` (§3.4) — בדוק את ה-API בdocs/ב-SDK
   - `acp/acp-transport.ts` (§3.5)
7. **Backend app/session:** `app/agent-session.ts` (§3.6)
8. **Backend orchestrator:** עדכן `app/agent-orchestrator.ts` (§3.7)
9. **Backend WS delivery:** `delivery/ws-agent.ts` (§3.8)
10. **Backend server:** עדכן `server.ts` (§3.9) — שים לב לbun.serve.websocket router (single handler)
11. **`pnpm typecheck && pnpm test && pnpm lint`** — תקן
12. **Frontend store:** `lib/stores/agent-session.ts` (§3.10a)
13. **Frontend route:** עדכן `routes/agent/[id]/+page.svelte` (§3.10b)
14. **`pnpm typecheck` ב-frontend**
15. **Smoke test:**
    - הפעל backend עם `OPENCODE_BIN=/home/user/.opencode/bin/opencode bun --watch packages/backend/src/server.ts`
    - הפעל frontend `pnpm dev`
    - פתח `http://localhost:5173/agent/new`, צור opencode agent עם cwd=/tmp
    - **אם spawn נכשל** — תעד את ה-error, ייתכן שצריך `OPENCODE_BIN=/home/user/.opencode/bin/opencode` או env vars אחרים
    - אם הצליח — נווט ל-`/agent/:id`, נסה לשלוח prompt טקסטואלי, אמור לראות chunks
16. **Commit:** `git add . && git commit -m "(slice-4): AcpTransport + chat טקסטואלי"`

---

## 5. Definition of Done

- [ ] `@agentclientprotocol/sdk` + `ws` ב-dependencies של backend
- [ ] Core schemas מורחבים (PromptMessage, CancelMessage, ConnectedMessage, ThinkingMessage, TextChunkMessage, ToolCallMessage, DoneMessage, ErrorMessage)
- [ ] Core port `AcpTransport`
- [ ] Backend: `acp/ws-streams.ts`, `acp/client-impl.ts`, `acp/acp-transport.ts`, `app/agent-session.ts`, `delivery/ws-agent.ts`
- [ ] Orchestrator: אחרי spawn → attach (initialize + session/new) → status=ready
- [ ] `pnpm typecheck` נקי
- [ ] `pnpm test` נקי (existing 52 ועוד tests חדשים — לפחות 60 סה"כ)
- [ ] `pnpm lint` נקי
- [ ] **Smoke E2E (אם אפשרי):** יצירת opencode agent דרך UI, שליחת prompt, קבלת text chunks. **אם נכשל** ב-spawn אמיתי — תעד את הסיבה (npx/opencode/permissions) ב-commit msg והמשך
- [ ] commit עם הודעה מפורטת

---

## 6. Slice 4 לא כולל

- **Voice** — Slice 5.
- **Multi-tab fan-out מלא** — basic support קיים (subscribers Set). Full pattern ב-Slice 6.
- **Reconnect-replay** — Slice 6.
- **Permissions UI** — auto-allow_once ב-Slice 4.
- **fs/terminal callbacks** — אופציונליים, לא נתמכים.

---

## 7. דיווח לסיום

החזר ל-Tama:
1. commit hash
2. DoD checklist
3. סטיות מ-brief — בייחוד אם ה-SDK API שונה ממה שתיכננתי (§3.4, §3.5)
4. **Smoke E2E result** — האם הצלחת ליצור opencode agent ולשלוח prompt? אם לא, מה השגיאה?
5. Test count
6. שאלות לקראת Slice 5 (voice)

**זמן צפוי:** 60-90 דקות (Slice הכי מורכב עד כה).

---

## 8. הוראה ל-Yolo

אתה ב-yolo mode. ה-SDK של ACP יכול להיות tricky — ייתכן ש-API שונה ממה שתיארתי. בדוק את ה-types בקובץ `.d.ts` של ה-SDK. אם משהו לא תואם, **תקן בעצמך לפי מה שה-SDK באמת מצפה**.

אם spawn אמיתי של opencode נכשל ב-smoke E2E — זה OK. תעד את ה-error המדויק (stdout/stderr של ה-bridge process), ועשה commit עם DoD מלא חוץ מה-E2E. אבי יוכל לנסות בעצמו בבוקר.

אל תיצור identity/auth/DB. השארת `requestPermission: auto-allow_once` is fine ב-Slice 4.
