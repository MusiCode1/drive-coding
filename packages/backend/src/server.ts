import "./log-setup.js" // MUST be first — initialises logger before any other imports
import * as path from "node:path"
import { createLogger } from "@drive-coding/core/log"
import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { WebSocketServer } from "ws"

const log = createLogger("backend.server")
const procLog = createLogger("backend.process")

// Safety nets — if any uncaught error slips through, log and exit gracefully.
// This is the last line of defense; production code should never reach here.
process.on("uncaughtException", (err) => {
  procLog.error(
    { err: { name: err.name, message: err.message, stack: err.stack } },
    "uncaughtException — exiting",
  )
  process.exit(1)
})

process.on("unhandledRejection", (reason) => {
  procLog.error({ reason: String(reason) }, "unhandledRejection — exiting")
  process.exit(1)
})

import { cors } from "hono/cors"
import { createBridgeManager } from "./acp/bridge-manager.js"
import { createInMemoryAgentRegistry } from "./agents/registry.js"
import { createAgentOrchestrator } from "./app/agent-orchestrator.js"
import { createProjectsRegistry } from "./app/projects-registry.js"
import { createRecordingsStore } from "./app/recordings-store.js"
import { parseCorsOrigins } from "./delivery/cors-config.js"
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
// Note: createSessionsCache removed — session listing is now FE-driven via ACP WS
import { createAgentWsHandler } from "./delivery/ws-agent.js"
import { createEchoWsHandler } from "./delivery/ws-echo.js"

const app = new Hono()

app.use("*", cors({ origin: parseCorsOrigins(process.env.CORS_ORIGINS), credentials: true }))

// Boot dependencies
const registry = createInMemoryAgentRegistry()
const bridgeManager = createBridgeManager()
const projectsRegistry = createProjectsRegistry(path.resolve("data/cache"))
const recordingsStore = createRecordingsStore(path.resolve("data/recordings"))

const orchestrator = createAgentOrchestrator({
  registry,
  bridgeManager,
  projectsRegistry,
})

// HTTP routes
registerHttp(app)
registerHttpOptions(app)
registerClientLogHttp(app)
registerAgentsHttp(app, { registry, orchestrator, projectsRegistry })
registerProjectsHttp(app, { projectsRegistry })
registerRecordingsHttp(app, { recordingsStore })
registerRecordingsPostHttp(app, { recordingsStore })
registerFsBrowseHttp(app)

// Slice 10: transparent proxy for Google + ElevenLabs
registerProxyHttp(app, { cacheBaseDir: path.resolve("data/cache/proxy") })

// WS handlers
const echoWss = new WebSocketServer({ noServer: true })
const agentWss = new WebSocketServer({ noServer: true })

const echoHandler = createEchoWsHandler()
const onAgentConnect = createAgentWsHandler({ orchestrator, bridgeManager })

echoWss.on("connection", (ws) => {
  echoHandler(ws)
})

agentWss.on("connection", (ws, req) => {
  // Extract agentId from URL
  const url = new URL(req.url ?? "", `http://localhost`)
  const match = url.pathname.match(/^\/ws\/agent\/([^/]+)$/)
  const agentId = match?.[1] ?? ""

  onAgentConnect(ws, agentId)
})

const port = Number(process.env.PORT ?? 4000)

const httpServer = serve({ fetch: app.fetch, port })

httpServer.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "", `http://localhost`)

  if (url.pathname === "/ws/echo") {
    echoWss.handleUpgrade(req, socket, head, (ws) => {
      echoWss.emit("connection", ws, req)
    })
    return
  }

  if (url.pathname.startsWith("/ws/agent/")) {
    agentWss.handleUpgrade(req, socket, head, (ws) => {
      agentWss.emit("connection", ws, req)
    })
    return
  }

  // Unknown WS path — destroy socket
  socket.destroy()
})

log.info({ port }, "listening")
