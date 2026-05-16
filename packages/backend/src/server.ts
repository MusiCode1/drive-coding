import * as path from "node:path"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { createBridgeManager } from "./acp/bridge-manager.js"
import { createInMemoryAgentRegistry } from "./agents/registry.js"
import { createAgentOrchestrator } from "./app/agent-orchestrator.js"
import { registerHttp } from "./delivery/http.js"
import { registerAgentsHttp } from "./delivery/http-agents.js"
import { type AgentWsData, createAgentWsHandler } from "./delivery/ws-agent.js"
import { type WsData as EchoWsData, registerEchoWs } from "./delivery/ws-echo.js"
import { DiskCache } from "./voice/cache-disk.js"
import { DEFAULT_REGISTRIES } from "./voice/providers.js"

const app = new Hono()

app.use("*", cors({ origin: ["http://localhost:5173"], credentials: true }))

// Boot dependencies
const registry = createInMemoryAgentRegistry()
const bridgeManager = createBridgeManager()
const orchestrator = createAgentOrchestrator({ registry, bridgeManager })

// Voice pipeline dependencies (Slice 5)
const ttsCache = new DiskCache(path.resolve("data/cache/tts"))
await ttsCache.init()

// HTTP routes
registerHttp(app)
registerAgentsHttp(app, { registry, orchestrator })

// WS handlers
const echo = registerEchoWs(app)
const agentWs = createAgentWsHandler({
  orchestrator,
  registries: DEFAULT_REGISTRIES,
  cache: ttsCache,
})

type WsData = EchoWsData | AgentWsData

const port = Number(process.env.PORT ?? 4000)

Bun.serve<WsData>({
  port,
  fetch(req, server) {
    const url = new URL(req.url)

    // /ws/echo — echo handler
    if (url.pathname === "/ws/echo") {
      const upgraded = server.upgrade(req, {
        data: { id: crypto.randomUUID() } satisfies EchoWsData,
      })
      if (upgraded) return undefined
      return new Response("WS upgrade failed", { status: 426 })
    }

    // /ws/agent/:id — agent handler
    if (url.pathname.startsWith("/ws/agent/")) {
      return agentWs.tryUpgrade(req, server) ?? app.fetch(req)
    }

    return app.fetch(req)
  },
  websocket: {
    // Unified WS handler — dispatch by ws.data.kind
    open(ws) {
      const data = ws.data as WsData
      if ("kind" in data && data.kind === "agent") {
        agentWs.websocket.open?.(ws as Parameters<typeof agentWs.websocket.open>[0])
      } else {
        echo.websocket.open?.(ws as Parameters<typeof echo.websocket.open>[0])
      }
    },
    message(ws, msg) {
      const data = ws.data as WsData
      if ("kind" in data && data.kind === "agent") {
        // biome-ignore lint/suspicious/noExplicitAny: unified WS dispatch
        agentWs.websocket.message?.(ws as any, msg)
      } else {
        // biome-ignore lint/suspicious/noExplicitAny: unified WS dispatch
        echo.websocket.message?.(ws as any, msg)
      }
    },
    close(ws, code, reason) {
      const data = ws.data as WsData
      if ("kind" in data && data.kind === "agent") {
        // biome-ignore lint/suspicious/noExplicitAny: unified WS dispatch
        agentWs.websocket.close?.(ws as any, code, reason)
      } else {
        // biome-ignore lint/suspicious/noExplicitAny: unified WS dispatch
        echo.websocket.close?.(ws as any, code, reason)
      }
    },
  },
})

console.log(`[backend] listening on http://localhost:${port}`)
