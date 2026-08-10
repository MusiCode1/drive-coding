import "./log-setup.js" // חייב להיות ראשון — מאתחל לוגר לפני כל יבוא אחר
import { createServer as httpsCreateServer } from "node:https"
import { createLogger } from "@drive-coding/core/log"
import { type ServerType, serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { Hono } from "hono"
import { WebSocketServer } from "ws"
import { isBinary } from "./binary.js"
import { preferPathClaudeExecutable } from "./config/prefer-path-cli.js"
import { isTransientSocketError } from "./delivery/transient-socket-error.js"
import { safeUrlPathname } from "./delivery/url-safe.js"
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
import type { BridgeKind } from "@drive-coding/core"
import { createAgentOrchestrator } from "./app/agent-orchestrator.js"
import { createProjectsRegistry } from "./app/projects-registry.js"
import { createRecordingsStore } from "./app/recordings-store.js"
import { parseCorsOrigins } from "./delivery/cors-config.js"
import { registerHttp } from "./delivery/http.js"
import { registerAgentsHttp } from "./delivery/http-agents.js"
import { registerCliAvailabilityHttp } from "./delivery/http-cli-availability.js"
import { registerCliLogoHttp } from "./delivery/http-cli-logo.js"
import { registerHealthHttp } from "./delivery/http-health.js"
import { registerClientLogHttp } from "./delivery/http-client-log.js"
import {
  registerFsBrowseHttp,
  registerProjectsHttp,
  registerRecordingsHttp,
  registerRecordingsPostHttp,
} from "./delivery/http-history.js"
import { registerHttpOptions } from "./delivery/http-options.js"
import { createAndRegisterSessionHostHttp } from "./session-host/http/index.js"
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

// S4 session-host-http: 4 routes — GET /events, POST /rpc, POST /reply, GET /state
// slice remote-warm-reconnect C1: תופסים את הרג'יסטרי (קודם נזרק ב-:151) — C2/C2b
// מעבירים אותו ל-ws-agent (guard) ול-orchestrator (ניקוי hosts ב-delete/crash).
const agentSessionRegistry = createAndRegisterSessionHostHttp(app, connectionRegistry, {
  onSessionAttached: async (agentId, sessionId) => {
    // בדיוק מה ש-POST /api/agents/:id/session-attached עושה (http-agents.ts) —
    // ה-endpoint ההוא נקרא רק מנתיבים מקומיים; ב-remote ה-SessionHost הוא שמצרף
    // את ה-session (אוטומטית ב-doCreate), אז הוא מדווח ישירות דרך ה-callback הזה.
    //
    // הכרעת MED-9: ה-callback הפנימי עוקף את guard ה-409 (http-agents.ts:142-150)
    // **בכוונה** — ב-remote ה-host הוא authoritative לגבי ה-session שלו.
    const agent = await registry.get(agentId)
    if (!agent || agent.status === "closed") {
      // race מול DELETE (deleteAndKill) — warn ודילוג, לא throw (הסשן חי; הפאנל יישאר ישן).
      log.warn({ agentId, sessionId }, "onSessionAttached: agent missing or closed — skipped")
      return
    }
    await registry.update(agentId, { status: "ready", acpSessionId: sessionId })
    await projectsRegistry.recordCwd(agent.cwd, agent.cliKind as BridgeKind)
    await projectsRegistry.recordSession(agent.cwd, sessionId)
  },
})

const orchestrator = createAgentOrchestrator({
  registry,
  connectionRegistry,
  projectsRegistry,
  // slice remote-warm-reconnect C2b: ניקוי hosts ב-delete/crash. אפשרי רק כי
  // agentSessionRegistry נוצר למעלה (לפני ה-orchestrator) — ר' ההערה שם.
  sessionHostRegistry: agentSessionRegistry,
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
// Slice be-diag-harness: endpoint אבחון עשיר (eventLoop histogram + memory + agents)
registerHealthHttp(app, { registry, connectionRegistry })
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

// Slice cli-availability: מסנן dropdown הספקים ב-FE לפי CLIs מותקנים בפועל
registerCliAvailabilityHttp(app)

// Slice cli-logo-serving: מגיש קובץ-לוגו CLI לפי id (id-keyed, ר' §3 בבריף)
registerCliLogoHttp(app)

// (session-host routes נרשמים למעלה — ליד יצירת agentSessionRegistry, לפני ה-orchestrator)

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
// slice remote-warm-reconnect C2: sessionHostRegistry → דחיית WS כש-host חי על הסוכן
const onAgentConnect = createAgentWsHandler({
  orchestrator,
  connectionRegistry,
  sessionHostRegistry: agentSessionRegistry,
})

echoWss.on("connection", (ws) => {
  echoHandler(ws)
})

agentWss.on("connection", (ws, req) => {
  // חלץ agentId מה-URL — defense-in-depth: אחרי upgrade-תקין לא אמור להיות null,
  // אבל אם כן (target פגום הגיע לכאן בכל-זאת) — סגור בטוח, אל תקרוס.
  const pathname = safeUrlPathname(req.url)
  if (pathname === null) {
    ws.close()
    return
  }
  const match = pathname.match(/^\/ws\/agent\/([^/]+)$/)
  const agentId = match?.[1] ?? ""

  onAgentConnect(ws, agentId)
})

preferPathClaudeExecutable()

const port = Number(process.env.PORT ?? 4000)
const hostname = process.env.DRIVE_CODING_HOST ?? "127.0.0.1"

const tls = resolveTls(process.env)
const httpServer: ServerType = tls
  ? serve({ fetch: app.fetch, hostname, port, createServer: httpsCreateServer, serverOptions: tls })
  : serve({ fetch: app.fetch, hostname, port })

httpServer.on("upgrade", (req, socket, head) => {
  // safeUrlPathname: עטיפה בטוחה ל-new URL — לעולם לא זורקת.
  // target פגום (למשל "//[::1") גורם ל-new URL לזרוק TypeError → uncaughtException → exit.
  // כאן: pathname===null → הרוס סוקט ו-return, ה-BE שורד.
  const pathname = safeUrlPathname(req.url)
  if (pathname === null) {
    log.warn({ url: req.url }, "upgrade: malformed request-target — destroying socket")
    socket.destroy()
    return
  }

  if (pathname === "/ws/echo") {
    echoWss.handleUpgrade(req, socket, head, (ws) => {
      echoWss.emit("connection", ws, req)
    })
    return
  }

  if (pathname.startsWith("/ws/agent/")) {
    agentWss.handleUpgrade(req, socket, head, (ws) => {
      agentWss.emit("connection", ws, req)
    })
    return
  }

  // נתיב WS לא ידוע — הרוס את הסוקט
  socket.destroy()
})

log.info({ hostname, port }, "listening")

// ─── Graceful shutdown ────────────────────────────────────────────────────────
// SIGINT (Ctrl+C) / SIGTERM — סגור חיבורים, הרוג ילדים, צא בצורה מסודרת.
// force-timeout: אם הכיבוי תקוע (hang) — הכרח יציאה אחרי 8s.
// usage-store: flush לפני יציאה (נקי יותר מ-SIGINT handler מקביל ב-usage-store).
let shuttingDown = false
async function gracefulShutdown(sig: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  procLog.info({ sig }, "graceful shutdown — closing connections + children")
  const force = setTimeout(() => {
    procLog.warn({}, "shutdown timeout — forcing exit")
    process.exit(0)
  }, 8000)
  force.unref()
  try {
    await Promise.allSettled(connectionRegistry.list().map((id) => connectionRegistry.close(id)))
    echoWss.close()
    agentWss.close()
    usageStore.flushUsageOnShutdown()
    await new Promise<void>((r) => httpServer.close(() => r()))
  } catch (e) {
    procLog.error({ err: e }, "error during shutdown")
  }
  process.exit(0)
}
process.on("SIGINT", () => void gracefulShutdown("SIGINT"))
process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"))

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
