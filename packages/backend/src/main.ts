import "./log-setup.js"
import { createServer as httpsCreateServer } from "node:https"
import { createLogger } from "@drive-coding/core/log"
import { type ServerType, serve } from "@hono/node-server"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { resolveAppVersion } from "./app-version.js"
import { buildApp } from "./boot/app.js"
import { loadAppConfig } from "./boot/config.js"
import { createDeps } from "./boot/deps.js"
import { registerShutdownHandlers } from "./boot/shutdown.js"
import { createWsStack } from "./boot/ws.js"
import { preferPathClaudeExecutable } from "./config/prefer-path-cli.js"
import { effectiveCorsOrigins } from "./delivery/cors-config.js"
import { isTransientSocketError } from "./delivery/transient-socket-error.js"
import { removeInstance, setSelfBaseUrl, writeInstance } from "./instances.js"
import { resolveTls } from "./tls.js"

const log = createLogger("backend.server")
const procLog = createLogger("backend.process")

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

const config = loadAppConfig()

preferPathClaudeExecutable()

const app = new Hono()

const corsOriginsRaw =
  config.corsOrigins !== undefined ? config.corsOrigins.join(",") : undefined
app.use("*", cors({ origin: effectiveCorsOrigins(corsOriginsRaw, config.publicBaseUrl), credentials: true }))

const { deps, disposables } = createDeps(config, process.env, app)
const ws = createWsStack()

await buildApp(app, config, deps, { broadcastConfigChanged: ws.broadcastConfigChanged })
ws.wireRoutes(app, deps)

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
writeInstance(instanceRecord, deps.env)
setSelfBaseUrl(instanceRecord)

registerShutdownHandlers(
  (sig) => ({
    sig,
    disposables,
    echoWss: ws.echoWss,
    agentWss: ws.agentWss,
    httpServer,
    boundPort,
    removeInstance: (p) => removeInstance(p, deps.env),
  }),
  boundPort,
  (p) => removeInstance(p, deps.env),
)
