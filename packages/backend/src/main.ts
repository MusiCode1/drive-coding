import "./log-setup.js"
import { createServer as httpsCreateServer } from "node:https"
import { configDefault } from "@drive-coding/core/config/specs"
import { createLogger } from "@drive-coding/core/log"
import { type ServerType, serve } from "@hono/node-server"
import { restorePersistedAgents } from "./agents/restore-agents.js"
import { resolveAppVersion } from "./app-version.js"
import { buildApp } from "./boot/app.js"
import { createAppWithCors } from "./boot/create-app.js"
import { createDeps } from "./boot/deps.js"
import { prepareBoot } from "./boot/prepare-boot.js"
import { registerShutdownHandlers } from "./boot/shutdown.js"
import { createWsStack } from "./boot/ws.js"
import { preferPathClaudeExecutable } from "./config/prefer-path-cli.js"
import { removeInstance, setSelfBaseUrl, writeInstance } from "./instances.js"
import { resolveTls } from "./tls.js"

const log = createLogger("backend.server")

const config = prepareBoot()

preferPathClaudeExecutable()

const app = createAppWithCors(config)

const { deps, disposables } = createDeps(config, process.env, app)

const ws = createWsStack()

// Routes and agent restoration are independent, and both must finish before the
// server accepts anything: restoring brings back agents whose sidecar outlived
// the previous process, so the first request sees the real list rather than an
// empty one that fills in a moment later.
await Promise.all([
  buildApp(app, config, deps, { broadcastConfigChanged: ws.broadcastConfigChanged }),
  restorePersistedAgents({
    registry: deps.registry,
    connections: deps.connectionRegistry,
    acpSessionIds: deps.acpSessionIdCache,
  }),
])
ws.wireRoutes(app, deps)

const port = config.port ?? configDefault("port")
const hostname = config.host ?? configDefault("host")

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
