/**
 * process-guards.ts — uncaughtException / unhandledRejection filters.
 */

import { createLogger } from "@drive-coding/core/log"
import { isTransientSocketError } from "../delivery/transient-socket-error.js"

const procLog = createLogger("backend.process")

export function registerProcessGuards(): void {
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
}
