import { Hono } from "hono"
import { cors } from "hono/cors"
import { createBridgeManager } from "./acp/bridge-manager"
import { createInMemoryAgentRegistry } from "./agents/registry"
import { createAgentOrchestrator } from "./app/agent-orchestrator"
import { registerHttp } from "./delivery/http"
import { registerAgentsHttp } from "./delivery/http-agents"
import { registerEchoWs, type WsData } from "./delivery/ws-echo"

const app = new Hono()

app.use("*", cors({ origin: ["http://localhost:5173"], credentials: true }))

// Boot dependencies
const registry = createInMemoryAgentRegistry()
const bridgeManager = createBridgeManager()
const orchestrator = createAgentOrchestrator({ registry, bridgeManager })

// HTTP routes
registerHttp(app)
registerAgentsHttp(app, { registry, orchestrator })

const echo = registerEchoWs(app) // returns { websocket } for Bun.serve

const port = Number(process.env.PORT ?? 4000)

Bun.serve<WsData>({
  port,
  fetch: (req, server) => {
    const url = new URL(req.url)
    if (url.pathname === "/ws/echo") {
      const upgraded = server.upgrade(req, { data: { id: crypto.randomUUID() } })
      if (upgraded) return // WS upgraded
      return new Response("WS upgrade failed", { status: 426 })
    }
    return app.fetch(req)
  },
  websocket: echo.websocket,
})

console.log(`[backend] listening on http://localhost:${port}`)
