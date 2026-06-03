import "./log-setup.js" // חייב להיות ראשון — מאתחל לוגר לפני כל יבוא אחר
import * as path from "node:path"
import { createLogger } from "@drive-coding/core/log"
import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { Hono } from "hono"
import { WebSocketServer } from "ws"

const log = createLogger("backend.server")
const procLog = createLogger("backend.process")

// רשתות ביטחון — אם שגיאה שלא נתפסה חומקת, תעד ללוג וצא בצורה מסודרת.
// זהו קו ההגנה האחרון; קוד ייצור לעולם לא אמור להגיע לכאן.
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
// הערה: createSessionsCache הוסר — רשימת הסשנים עכשיו מונעת מצד ה-FE דרך ACP WS
import { createAgentWsHandler } from "./delivery/ws-agent.js"
import { createEchoWsHandler } from "./delivery/ws-echo.js"

const app = new Hono()

app.use("*", cors({ origin: parseCorsOrigins(process.env.CORS_ORIGINS), credentials: true }))

// תלויות הפעלה (Boot dependencies)
const registry = createInMemoryAgentRegistry()
const bridgeManager = createBridgeManager()
const projectsRegistry = createProjectsRegistry(path.resolve("data/cache"))
const recordingsStore = createRecordingsStore(path.resolve("data/recordings"))

const orchestrator = createAgentOrchestrator({
  registry,
  bridgeManager,
  projectsRegistry,
})

// נתיבי HTTP
registerHttp(app)
registerHttpOptions(app)
registerClientLogHttp(app)
registerAgentsHttp(app, { registry, orchestrator, projectsRegistry })
registerProjectsHttp(app, { projectsRegistry })
registerRecordingsHttp(app, { recordingsStore })
registerRecordingsPostHttp(app, { recordingsStore })
registerFsBrowseHttp(app)

// Slice 10: פרוקסי שקוף עבור Google + ElevenLabs
registerProxyHttp(app, { cacheBaseDir: path.resolve("data/cache/proxy") })

// Slice 20: serve the built static FE (single-origin local prod).
// Guarded by FE_STATIC_DIR — when unset (dev mode), Vite serves the FE
// and this block is skipped, so the BE stays API/WS/proxy-only.
const feStaticDir = process.env.FE_STATIC_DIR
if (feStaticDir) {
  // Assets first (js/css/etc), then SPA fallback to index.html for any
  // unmatched path (client-side routing). Registered AFTER all /api,/proxy
  // routes so it never shadows them.
  app.use("/*", serveStatic({ root: feStaticDir }))
  app.get("/*", serveStatic({ path: `${feStaticDir}/index.html` }))
  log.info({ feStaticDir }, "serving static FE")
}

// מטפלי WS
const echoWss = new WebSocketServer({ noServer: true })
const agentWss = new WebSocketServer({ noServer: true })

const echoHandler = createEchoWsHandler()
const onAgentConnect = createAgentWsHandler({ orchestrator, bridgeManager })

echoWss.on("connection", (ws) => {
  echoHandler(ws)
})

agentWss.on("connection", (ws, req) => {
  // חלץ agentId מה-URL
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

  // נתיב WS לא ידוע — הרוס את הסוקט
  socket.destroy()
})

log.info({ port }, "listening")

// ─── TEMPORARY (slice 26): idle-bridge reaper ───
// Safety net for bridges leaked by a plain reload / closed tab (cases that
// slice 25's FE cleanup does NOT cover). DELETE THIS BLOCK when background-agent
// management (future "slice A") lands. See docs/plans/slice-26-bridge-idle-reaper.md §7.
const BRIDGE_IDLE_TIMEOUT_MS = Number(process.env.BRIDGE_IDLE_TIMEOUT_MS ?? 300_000)
const REAP_INTERVAL_MS = Math.min(BRIDGE_IDLE_TIMEOUT_MS, 60_000)
const reaperLog = createLogger("backend.reaper")
const reaper = setInterval(() => {
  const now = Date.now()
  const idle = bridgeManager.listIdle(BRIDGE_IDLE_TIMEOUT_MS, now)
  for (const id of idle) {
    reaperLog.info({ agentId: id }, "reaping idle bridge")
    orchestrator.deleteAndKill(id).catch((e) =>
      reaperLog.warn({ err: e, agentId: id }, "reap failed"),
    )
  }
}, REAP_INTERVAL_MS)
reaper.unref() // do not keep the event loop alive just for the reaper

/**
 * הרצה ידנית (dev/debug) — BE על פורט נפרד, משרת FE סטטי, דרך OneCLI:
 *
 *   OPENCODE_BIN=/home/user/projects/voice-acp/dev/scripts/opencode-clean.sh \
 *   FE_STATIC_DIR=/home/user/projects/voice-acp/dev/packages/frontend/build \
 *   CORS_ORIGINS="https://drive-coding.pages.dev" \
 *   PORT=4005 LOG_LEVEL=trace LOG_NS='*' LOG_FORMAT=pretty \
 *   onecli run --agent voice-acp -- bun --watch \
 *   /home/user/projects/voice-acp/dev/packages/backend/src/server.ts
 *
 * השירות הקבוע (systemd) מוגדר ב-deploy/systemd/voice-acp-be.service.
 */
