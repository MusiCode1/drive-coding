import "./log-setup.js" // חייב להיות ראשון — מאתחל לוגר לפני כל יבוא אחר
import { createServer as httpsCreateServer } from "node:https"
import { createLogger } from "@drive-coding/core/log"
import { type ServerType, serve } from "@hono/node-server"
import { Hono } from "hono"
import { preferPathClaudeExecutable } from "./config/prefer-path-cli.js"
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
import { resolveAppVersion } from "./app-version.js"
import { buildApp } from "./boot/app.js"
import { loadAppConfig } from "./boot/config.js"
import { createDeps } from "./boot/deps.js"
import { createWsStack } from "./boot/ws.js"
import { effectiveCorsOrigins } from "./delivery/cors-config.js"
import { removeInstance, setSelfBaseUrl, writeInstance } from "./instances.js"

const config = loadAppConfig()

const app = new Hono()

const corsOriginsRaw =
  config.corsOrigins !== undefined ? config.corsOrigins.join(",") : undefined
app.use("*", cors({ origin: effectiveCorsOrigins(corsOriginsRaw, config.publicBaseUrl), credentials: true }))

const { deps, disposables } = createDeps(config, process.env, app)
const ws = createWsStack()

await buildApp(app, config, deps, { broadcastConfigChanged: ws.broadcastConfigChanged })
ws.wireRoutes(app, deps)

preferPathClaudeExecutable()

const port = config.port ?? 4000
const hostname = config.host ?? "127.0.0.1"

const tls = resolveTls(process.env)
const httpServer: ServerType = tls
  ? serve({ fetch: app.fetch, hostname, port, createServer: httpsCreateServer, serverOptions: tls })
  : serve({ fetch: app.fetch, hostname, port })

ws.attachUpgradeHandler(httpServer)

log.info({ hostname, port }, "listening")

const bound = httpServer.address()
const boundPort = typeof bound === "object" && bound !== null ? bound.port : port
const instanceRecord = {
  port: boundPort,
  host: hostname,
  pid: process.pid,
  version: resolveAppVersion(),
  cwd: process.cwd(),
  https: Boolean(tls),
  startedAt: Date.now(),
}
writeInstance(instanceRecord)
setSelfBaseUrl(instanceRecord)

// ─── Graceful shutdown ────────────────────────────────────────────────────────
// SIGINT (Ctrl+C) / SIGTERM — סגור חיבורים, הרוג ילדים, צא בצורה מסודרת.
// force-timeout: אם הכיבוי תקוע (hang) — הכרח יציאה אחרי 8s.
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
    removeInstance(boundPort)
    for (const d of [...disposables].reverse()) {
      await Promise.resolve(d.dispose())
    }
    ws.echoWss.close()
    ws.agentWss.close()
    await new Promise<void>((r) => httpServer.close(() => r()))
  } catch (e) {
    procLog.error({ err: e }, "error during shutdown")
  }
  process.exit(0)
}
process.on("SIGINT", () => void gracefulShutdown("SIGINT"))
process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"))
process.on("exit", () => {
  removeInstance(boundPort)
})

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
