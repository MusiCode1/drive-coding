/**
 * Frontend logger — thin re-export from @drive-coding/core/log (browser entry).
 *
 * Import this module (NOT @drive-coding/core/log directly) from all FE code.
 * initLogger is called once here with the config from window.__LOG__ (set by app.html inline script).
 */
import { createLogger, initLogger } from "@drive-coding/core/log"

declare global {
  interface Window {
    __LOG__: import("@drive-coding/core/log").LogConfig
  }
}

initLogger(
  typeof window !== "undefined" && window.__LOG__
    ? window.__LOG__
    : { level: "info", ns: "*", format: "pretty", remote: false },
)

export { createLogger }
