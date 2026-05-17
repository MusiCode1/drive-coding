import "./log-setup.js" // MUST be first — initialises logger before any other imports
import * as path from "node:path"
import { createLogger } from "@drive-coding/core/log"
import { Hono } from "hono"

const log = createLogger("backend.server")

import { cors } from "hono/cors"
import { createBridgeManager } from "./acp/bridge-manager.js"
import { createInMemoryAgentRegistry } from "./agents/registry.js"
import { createAgentOrchestrator } from "./app/agent-orchestrator.js"
import { createProjectsRegistry } from "./app/projects-registry.js"
import { createRecordingsStore } from "./app/recordings-store.js"
import { createSessionsCache } from "./app/sessions-cache.js"
import { registerHttp } from "./delivery/http.js"
import { registerAgentsHttp } from "./delivery/http-agents.js"
import { registerClientLogHttp } from "./delivery/http-client-log.js"
import {
  registerFsBrowseHttp,
  registerProjectsHttp,
  registerRecordingsHttp,
  registerRecordingsPostHttp,
} from "./delivery/http-history.js"
import { registerHttpOptions } from "./delivery/http-options.js"
import { registerProxyHttp } from "./delivery/http-proxy.js"
import { type AgentWsData, createAgentWsHandler } from "./delivery/ws-agent.js"
import { type WsData as EchoWsData, registerEchoWs } from "./delivery/ws-echo.js"
import { DiskCache } from "./voice/cache-disk.js"

const app = new Hono()

app.use("*", cors({ origin: ["http://localhost:5173"], credentials: true }))

// Boot dependencies
const registry = createInMemoryAgentRegistry()
const bridgeManager = createBridgeManager()
const projectsRegistry = createProjectsRegistry(path.resolve("data/cache"))
const sessionsCache = createSessionsCache()
const recordingsStore = createRecordingsStore(path.resolve("data/recordings"))

const orchestrator = createAgentOrchestrator({
  registry,
  bridgeManager,
  projectsRegistry,
})

// fetchSessions: spawns a temp bridge, calls session/list, kills bridge
// NOTE: listSessionsFromBridge is still used here for the sessions UI (not removed in Phase 1)
const { listSessionsFromBridge } = await import("./acp/acp-transport.js")

async function fetchSessions(cwd: string) {
  const projects = await projectsRegistry.getProjects()
  const entry = projects.find((p) => p.cwd === cwd)
  if (!entry) return []
  const bridgeId = crypto.randomUUID()
  try {
    const handle = await bridgeManager.spawn(bridgeId, {
      cliKind: entry.kind,
      cwd,
      modelOverride: null,
    })
    const result = await listSessionsFromBridge({ wsUrl: handle.wsUrl, cwd })
    return result.isOk() ? [...result.value] : []
  } catch {
    return []
  } finally {
    await bridgeManager.kill(bridgeId).catch(() => {})
  }
}

// TTS disk cache (kept for backward compat — Phase 4 will remove)
const ttsCache = new DiskCache(path.resolve("data/cache/tts"))
await ttsCache.init()

// HTTP routes
registerHttp(app)
registerHttpOptions(app)
registerClientLogHttp(app)
registerAgentsHttp(app, { registry, orchestrator, projectsRegistry })
registerProjectsHttp(app, { projectsRegistry, sessionsCache, fetchSessions })
registerRecordingsHttp(app, { recordingsStore })
registerRecordingsPostHttp(app, { recordingsStore })
registerFsBrowseHttp(app)

// Slice 10: transparent proxy for Google + ElevenLabs
registerProxyHttp(app, { cacheBaseDir: path.resolve("data/cache/proxy") })

// WS handlers
const echo = registerEchoWs(app)
const agentWs = createAgentWsHandler({ orchestrator })

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

log.info({ port }, "listening")
