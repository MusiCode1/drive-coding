/**
 * boot/shutdown.ts — graceful shutdown via reverse disposable fold (C4).
 */

import { createLogger } from "@drive-coding/core/log"
import type { ServerType } from "@hono/node-server"
import type { WebSocketServer } from "ws"
import type { Disposable } from "./deps.js"

const procLog = createLogger("backend.process")

export type ShutdownOpts = {
  sig: string
  disposables: Disposable[]
  echoWss: WebSocketServer
  agentWss: WebSocketServer
  httpServer: ServerType
  boundPort: number
  removeInstance: (port: number) => void
}

let shuttingDown = false

export async function gracefulShutdown(opts: ShutdownOpts): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  procLog.info({ sig: opts.sig }, "graceful shutdown — closing connections + children")
  const force = setTimeout(() => {
    procLog.warn({}, "shutdown timeout — forcing exit")
    process.exit(0)
  }, 8000)
  force.unref()
  try {
    opts.removeInstance(opts.boundPort)
    for (const d of [...opts.disposables].reverse()) {
      await Promise.resolve(d.dispose())
    }
    opts.echoWss.close()
    opts.agentWss.close()
    await new Promise<void>((r) => opts.httpServer.close(() => r()))
  } catch (e) {
    procLog.error({ err: e }, "error during shutdown")
  }
  process.exit(0)
}

export function registerShutdownHandlers(
  getOpts: (sig: string) => ShutdownOpts,
  boundPort: number,
  removeInstance: (port: number) => void,
): void {
  process.on("SIGINT", () => void gracefulShutdown(getOpts("SIGINT")))
  process.on("SIGTERM", () => void gracefulShutdown(getOpts("SIGTERM")))
  process.on("exit", () => {
    removeInstance(boundPort)
  })
}
