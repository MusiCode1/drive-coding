/**
 * Frontend logger — אתחול יחיד של @drive-coding/core/log (כניסת browser).
 *
 * לייבא מכאן, לא מ-`@drive-coding/core/log` ישירות, כדי ש-init יקרה פעם אחת.
 * בבילד שאינו prod (`__DC_ENABLED__`) remote דולק כברירת מחדל — POST /api/client-log.
 * כיבוי: `?logRemote=0`. הדלקה מפורשת בכל סביבה: `?logRemote=1`.
 */

import { createLogger, getLogConfig, initLogger, parseLogConfig } from "@drive-coding/core/log"

const previewRemote = typeof __DC_ENABLED__ !== "undefined" && __DC_ENABLED__

function browserStorage():
  | { getItem(key: string): string | null; setItem(key: string, v: string): void }
  | undefined {
  try {
    const ls = globalThis.localStorage
    if (!ls || typeof ls.getItem !== "function") return undefined
    return ls
  } catch {
    return undefined
  }
}

initLogger(
  parseLogConfig({
    search: typeof window !== "undefined" ? window.location.search : "",
    localStorage: browserStorage(),
    defaults: {
      level: "info",
      ns: "*",
      format: "pretty",
      remote: previewRemote,
    },
  }),
)

export { createLogger, getLogConfig }
