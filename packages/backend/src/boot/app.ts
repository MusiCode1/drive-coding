/**
 * boot/app.ts — HTTP route registration + static FE (C3 pure extraction).
 */

import type { DriveCodingConfig } from "@drive-coding/core/config/schema"
import { createLogger } from "@drive-coding/core/log"
import { onConfigChange } from "@drive-coding/provider/config"
import { serveStatic } from "@hono/node-server/serve-static"
import type { Hono } from "hono"
import { isBinary } from "../binary.js"
import { registerHttp } from "../delivery/http.js"
import { registerAgentsHttp } from "../delivery/http-agents.js"
import { registerCliAvailabilityHttp } from "../delivery/http-cli-availability.js"
import { registerCliLogoHttp } from "../delivery/http-cli-logo.js"
import { registerClientLogHttp } from "../delivery/http-client-log.js"
import { registerFsFileHttp } from "../delivery/http-fs-file.js"
import { registerHealthHttp } from "../delivery/http-health.js"
import {
  registerFsBrowseHttp,
  registerProjectsHttp,
  registerRecordingsHttp,
  registerRecordingsPostHttp,
} from "../delivery/http-history.js"
import { registerLiveTokenHttp } from "../delivery/http-live-token.js"
import { registerAgentPromptHttp } from "../delivery/http-agent-prompt.js"
import { bootAgentEvents } from "../delivery/agent-events-boot.js"
import { registerMcpHttp } from "../delivery/http-mcp.js"
import { registerHttpOptions } from "../delivery/http-options.js"
import { registerProxyHttp } from "../delivery/http-proxy.js"
import { registerReloadConfigHttp } from "../delivery/http-reload-config.js"
import { registerTtsCapabilitiesHttp } from "../delivery/http-tts-capabilities.js"
import { registerUsageHttp } from "../delivery/http-usage.js"
import { ensureStateSubdir } from "../paths.js"
import type { BootDeps } from "./deps.js"

const log = createLogger("backend.server")

export async function buildApp(
  app: Hono,
  config: DriveCodingConfig,
  deps: BootDeps,
  opts: { broadcastConfigChanged: () => void },
): Promise<void> {
  const {
    registry,
    connectionRegistry,
    projectsRegistry,
    recordingsStore,
    agentSessionRegistry,
    agentEventBus,
    orchestrator,
    usageStore,
    memoryGuard,
  } = deps

  const { orchestrator: orchestratorWithEvents } = bootAgentEvents(app, {
    registry,
    orchestrator,
    eventBus: agentEventBus,
    agentSessionRegistry,
  })

  const { env } = deps
  const urlConfig = config

  registerHttp(app)
  registerHttpOptions(app)
  registerTtsCapabilitiesHttp(app, env)
  registerLiveTokenHttp(app, env)
  registerClientLogHttp(app)
  registerAgentsHttp(app, {
    registry,
    orchestrator: orchestratorWithEvents,
    projectsRegistry,
    bridgeManager: connectionRegistry,
    env,
  })
  registerMcpHttp(app, {
    registry,
    orchestrator: orchestratorWithEvents,
    agentSessionRegistry,
    env,
    urlConfig,
    eventBus: agentEventBus,
  })
  registerAgentPromptHttp(app, { registry, urlConfig })
  registerHealthHttp(app, { registry, connectionRegistry })
  registerProjectsHttp(app, { projectsRegistry })
  registerRecordingsHttp(app, { recordingsStore })
  registerRecordingsPostHttp(app, { recordingsStore })
  registerFsBrowseHttp(app, {
    allowedBase: config.fsBrowseBase ?? env.FS_BROWSE_ALLOWED_BASE,
  })
  registerFsFileHttp(app, { allowedBase: env.FS_FILE_ALLOWED_BASE })

  registerProxyHttp(app, {
    cacheBaseDir: ensureStateSubdir("cache", "proxy"),
    usageStore,
    memoryGuard,
    env,
  })

  registerUsageHttp(app, { usageStore })
  registerCliAvailabilityHttp(app, env)

  onConfigChange(() => opts.broadcastConfigChanged())
  registerReloadConfigHttp(app)
  registerCliLogoHttp(app, env)

  const feStaticDir = config.feStaticDir
  if (isBinary() && !feStaticDir) {
    const { FE } = await import("../fe-manifest.gen.js")
    const indexPath: string | undefined = FE["/index.html"]
    app.use("/*", async (c, next) => {
      const p: string | undefined = FE[c.req.path]
      if (p) return new Response(Bun.file(p))
      return next()
    })
    if (indexPath) {
      app.get("/*", () => new Response(Bun.file(indexPath)))
    }
    log.info({}, "serving embedded FE from binary manifest")
  } else if (feStaticDir) {
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
}
