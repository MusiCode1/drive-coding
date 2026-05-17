/**
 * Node.js logger entry — createLogger, initLogger, addSink, getLogConfig.
 *
 * Uses pino for structured logging.
 * Dual transport: stderr (pretty) + stdout (JSON) controlled by config.format.
 */
import pino from "pino"
import { isEnabledForNs } from "./namespace.js"
import type { Fields, Level, LogConfig, LogEntry, Logger } from "./types.js"

export { parseEnvConfig, parseLogConfig } from "./config.js"
export type { Fields, Level, LogConfig, LogEntry, Logger }
export { isEnabledForNs }

// ── Global state ──────────────────────────────────────────────────────────────

let _config: LogConfig = {
  level: "info",
  ns: "*",
  format: "both",
  remote: false,
}

const _sinks: Array<(entry: LogEntry) => void> = []

// ── pino instances (lazy, created on first initLogger call) ───────────────────

let _pinoJson: pino.Logger | null = null
let _pinoPretty: pino.Logger | null = null

function createPino(destination: NodeJS.WritableStream, pretty: boolean): pino.Logger {
  if (pretty) {
    return pino(
      {
        level: "trace",
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            ignore: "pid,hostname",
            translateTime: "HH:MM:ss.l",
          },
        },
      },
      destination,
    )
  }
  return pino({ level: "trace" }, destination)
}

// ── Public API ────────────────────────────────────────────────────────────────

export function initLogger(config: LogConfig): void {
  _config = config
  _pinoJson = null
  _pinoPretty = null

  if (config.format === "json" || config.format === "both") {
    _pinoJson = createPino(process.stdout, false)
  }
  if (config.format === "pretty" || config.format === "both") {
    _pinoPretty = createPino(process.stderr, true)
  }
}

export function getLogConfig(): LogConfig {
  return _config
}

/** Add a custom sink. Returns an unsubscribe function. */
export function addSink(sink: (entry: LogEntry) => void): () => void {
  _sinks.push(sink)
  return () => {
    const idx = _sinks.indexOf(sink)
    if (idx >= 0) _sinks.splice(idx, 1)
  }
}

/** Create a logger for the given namespace. */
export function createLogger(namespace: string): Logger {
  return makeLogger(namespace, {})
}

// ── Internal ──────────────────────────────────────────────────────────────────

const LEVEL_VALUES: Record<Level, number> = {
  silent: 100,
  error: 50,
  warn: 40,
  info: 30,
  debug: 20,
  trace: 10,
}

function isEnabled(level: Level, ns: string): boolean {
  if (_config.level === "silent") return false
  if (LEVEL_VALUES[level] < LEVEL_VALUES[_config.level]) return false
  return isEnabledForNs(ns, _config.ns)
}

function emit(level: Level, ns: string, fields: Fields, msg: string | undefined): void {
  if (!isEnabled(level, ns)) return

  const ts = Date.now()

  // Emit to pino sinks
  const pinoFields = { ns, ...fields }
  if (level !== "silent") {
    if (_pinoJson) _pinoJson[level](pinoFields, msg ?? "")
    if (_pinoPretty) _pinoPretty[level](pinoFields, msg ?? "")
  }

  // Emit to custom sinks
  if (_sinks.length > 0) {
    const entry: LogEntry = {
      ts,
      level,
      ns,
      msg,
      fields: Object.keys(fields).length > 0 ? fields : undefined,
    }
    for (const sink of _sinks) {
      try {
        sink(entry)
      } catch {
        // Sink errors don't break the logger
      }
    }
  }
}

function makeLogger(ns: string, inheritedFields: Fields): Logger {
  return {
    trace(fields?: Fields, msg?: string) {
      emit("trace", ns, { ...inheritedFields, ...fields }, msg)
    },
    debug(fields?: Fields, msg?: string) {
      emit("debug", ns, { ...inheritedFields, ...fields }, msg)
    },
    info(fields?: Fields, msg?: string) {
      emit("info", ns, { ...inheritedFields, ...fields }, msg)
    },
    warn(fields?: Fields, msg?: string) {
      emit("warn", ns, { ...inheritedFields, ...fields }, msg)
    },
    error(fieldsOrErr?: Fields | Error, msg?: string) {
      const fields: Fields =
        fieldsOrErr instanceof Error
          ? { err: fieldsOrErr.message, stack: fieldsOrErr.stack }
          : (fieldsOrErr ?? {})
      emit("error", ns, { ...inheritedFields, ...fields }, msg)
    },
    child(fields: Fields): Logger {
      return makeLogger(ns, { ...inheritedFields, ...fields })
    },
    ns(suffix: string): Logger {
      return makeLogger(`${ns}.${suffix}`, inheritedFields)
    },
  }
}
