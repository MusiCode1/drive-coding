import "./log-setup.js" // חייב להיות ראשון — מאתחל לוגר לפני כל יבוא אחר
import { createServer as httpsCreateServer } from "node:https"
import { createLogger } from "@drive-coding/core/log"
import { type ServerType, serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { Hono } from "hono"
import { WebSocketServer } from "ws"
import { isBinary } from "./binary.js"
import { isTransientSocketError } from "./delivery/transient-socket-error.js"
import { resolveTls } from "./tls.js"

const log = createLogger("backend.server")
const procLog = createLogger("backend.process")

// רשתות ביטחון — אם שגיאה שלא נתפסה חומקת, תעד ללוג וצא בצורה מסודרת.
// זהו קו ההגנה האחרון; קוד ייצור לעולם לא אמור להגיע לכאן.
// ריכוך: שגיאות socket חולפות (ECONNRESET, EPIPE וכו') — warn + return, לא exit.
// שגיאות אמיתיות — process.exit(1) כמו קודם (שומר על קו ההגנה לבאגים).
process.on("uncaughtException", (err) => {
  const transient = isTransientSocketError(err)
  const code = (err as NodeJS.ErrnoException).code
  if (transient) {
    procLog.warn(
      { err: { name: err.name, message: err.message, code }, transient: true },
      "uncaughtException — transient socket error, ignoring",
    )
    return
  }
  procLog.error(
    { err: { name: err.name, message: err.message, stack: err.stack, code }, transient: false },
    "uncaughtException — exiting",
  )
  process.exit(1)
})

process.on("unhandledRejection", (reason) => {
  const transient = isTransientSocketError(reason)
  if (transient) {
    procLog.warn(
      { reason: String(reason), transient: true },
      "unhandledRejection — transient socket error, ignoring",
    )
    return
  }
  procLog.error({ reason: String(reason), transient: false }, "unhandledRejection — exiting")
  process.exit(1)
})

import { cors } from "hono/cors"
import { createConnectionRegistry } from "./acp/connection-registry.js"
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
import { registerTtsCapabilitiesHttp } from "./delivery/http-tts-capabilities.js"
import { registerUsageHttp } from "./delivery/http-usage.js"
import { createMemoryGuard } from "./delivery/memory-guard.js"
import { createWireRecorder } from "./delivery/wire-recorder.js"
// הערה: createSessionsCache הוסר — רשימת הסשנים עכשיו מונעת מצד ה-FE דרך ACP WS
import { createAgentWsHandler } from "./delivery/ws-agent.js"
import { createEchoWsHandler } from "./delivery/ws-echo.js"
import { ensureStateSubdir } from "./paths.js"
import { createUsageStore } from "./usage/usage-store.js"

const app = new Hono()

app.use("*", cors({ origin: parseCorsOrigins(process.env.CORS_ORIGINS), credentials: true }))

// תלויות הפעלה (Boot dependencies)
const registry = createInMemoryAgentRegistry()

// wire-recorder: פעיל כש-WIRE_RECORD=1; אחרת no-op (אפס IO, אפס overhead)
const wireRecorder = createWireRecorder({
  dir: process.env.WIRE_RECORD ? ensureStateSubdir("wire-recordings") : null,
})

// CUT-3b-ii: connection-registry מחליף את bridge-manager singleton.
// wireRecorder מוזרם ל-registry (server יוצר, registry מחבר ל-conn.onFrame פר-agent).
const connectionRegistry = createConnectionRegistry({ wireRecorder })
const projectsRegistry = createProjectsRegistry(ensureStateSubdir("cache"))
const recordingsStore = createRecordingsStore(ensureStateSubdir("recordings"))

const orchestrator = createAgentOrchestrator({
  registry,
  connectionRegistry,
  projectsRegistry,
})

// נתיבי HTTP
registerHttp(app)
registerHttpOptions(app)
registerTtsCapabilitiesHttp(app)
registerClientLogHttp(app)
// CUT-3b-ii: connectionRegistry מספק getRuntimeInfo (מחליף bridgeManager)
registerAgentsHttp(app, {
  registry,
  orchestrator,
  projectsRegistry,
  bridgeManager: connectionRegistry,
})
registerProjectsHttp(app, { projectsRegistry })
registerRecordingsHttp(app, { recordingsStore })
registerRecordingsPostHttp(app, { recordingsStore })
registerFsBrowseHttp(app)

// Slice tts-usage-metering: usage metering store
const usageStore = createUsageStore(ensureStateSubdir("usage"))

// Slice proxy-tap-memory: RSS watchdog — defense-in-depth if TransformStream approach fails.
// Polls RSS every 5s; returns 503 on /proxy/* when over budget (default: 1.5GB).
// Override threshold with RSS_BUDGET_MB env var.
const memoryGuard = createMemoryGuard()

// Slice 10: פרוקסי שקוף עבור Google + ElevenLabs (+ usage tap)
registerProxyHttp(app, {
  cacheBaseDir: ensureStateSubdir("cache", "proxy"),
  usageStore,
  memoryGuard,
})

// Slice tts-usage-metering: usage summary endpoint
registerUsageHttp(app, { usageStore })

// Slice 20: serve the built static FE (single-origin local prod).
// Binary mode: serve from embedded FE manifest (assets in $bunfs, no disk reads).
// Dev mode / explicit FE_STATIC_DIR: serve from filesystem via serveStatic.
const feStaticDir = process.env.FE_STATIC_DIR
if (isBinary() && !feStaticDir) {
  // Binary mode with no explicit FE_STATIC_DIR override — serve from embedded manifest.
  // Dynamic import so the stub compiles cleanly in dev (never executes in dev).
  const { FE } = await import("./fe-manifest.gen.js")
  // noUncheckedIndexedAccess: FE[key] is string | undefined — guard required.
  const indexPath: string | undefined = FE["/index.html"]
  // Assets: serve any path found in the manifest.
  app.use("/*", async (c, next) => {
    const p: string | undefined = FE[c.req.path]
    if (p) return new Response(Bun.file(p))
    return next()
  })
  // SPA fallback: any unmatched GET → index.html (client-side routing).
  if (indexPath) {
    app.get("/*", () => new Response(Bun.file(indexPath)))
  }
  log.info({}, "serving embedded FE from binary manifest")
} else if (feStaticDir) {
  // Dev / explicit override: serve from filesystem.
  // Assets first (js/css/etc), then SPA fallback to index.html for any
  // unmatched path (client-side routing). Registered AFTER all /api,/proxy
  // routes so it never shadows them.
  //
  // Cache-Control (cache-version slice): onFound נקרא רק כשקובץ נמצא —
  // נקי יותר ממiddleware (אין צורך ב-await next() + guard). ה-/api,/proxy
  // רשומים לפני הבלוק הזה ו-terminal, כך שלעולם לא מגיעים לכאן. /ws
  // מטופל ב-httpServer.on("upgrade") לפני Hono — גם לא מגיע לכאן.
  // guard מפורש לבטחון נוסף.
  app.use(
    "/*",
    serveStatic({
      root: feStaticDir,
      onFound: (_path, c) => {
        const reqPath = c.req.path
        if (reqPath.startsWith("/api") || reqPath.startsWith("/proxy")) return
        if (reqPath.startsWith("/_app/immutable/")) {
          c.header("Cache-Control", "public, max-age=31536000, immutable")
        } else {
          c.header("Cache-Control", "no-cache")
        }
      },
    }),
  )
  app.get(
    "/*",
    serveStatic({
      path: `${feStaticDir}/index.html`,
      onFound: (_path, c) => {
        c.header("Cache-Control", "no-cache")
      },
    }),
  )
  log.info({ feStaticDir }, "serving static FE")
}

// מטפלי WS
const echoWss = new WebSocketServer({ noServer: true })
const agentWss = new WebSocketServer({ noServer: true })

// error listeners על שרתי WS — מונעים throw (unhandled EventEmitter error) על שגיאות רמת-שרת
echoWss.on("error", (err) => procLog.warn({ src: "echoWss", err }, "wss error"))
agentWss.on("error", (err) => procLog.warn({ src: "agentWss", err }, "wss error"))

const echoHandler = createEchoWsHandler()
// CUT-3b-ii: connectionRegistry מחליף bridgeManager ב-ws-agent
const onAgentConnect = createAgentWsHandler({ orchestrator, connectionRegistry })

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
const hostname = process.env.DRIVE_CODING_HOST ?? "127.0.0.1"

const tls = resolveTls(process.env)
const httpServer: ServerType = tls
  ? serve({ fetch: app.fetch, hostname, port, createServer: httpsCreateServer, serverOptions: tls })
  : serve({ fetch: app.fetch, hostname, port })

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

log.info({ hostname, port }, "listening")

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
