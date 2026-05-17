/**
 * Backend log initialization — MUST be imported first in server.ts (before all other imports).
 *
 * Reads LOG_LEVEL, LOG_NS, LOG_FORMAT, LOG_WIRE from process.env.
 * LOG_WIRE shortcut: "acp" | "ws" | "1" — sets level=trace + the relevant wire namespace.
 */
import { initLogger, parseEnvConfig } from "@drive-coding/core/log"

const config = parseEnvConfig()
initLogger(config)
