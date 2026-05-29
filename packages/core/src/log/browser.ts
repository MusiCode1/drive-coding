/**
 * נקודת כניסה של ה-logger לדפדפן — אותו API כמו index.ts, משתמש ב-pino/browser.
 *
 * מיובא על ידי: packages/frontend/src/lib/log.ts
 *
 * pino/browser מוציא לקונסולה (יחסית יפה) ותומך ב-transmit עבור יעד מרוחק (remote sink).
 */
// @ts-expect-error — ל-pino/browser אין bundled .d.ts; ה-skipLibCheck מכסה את זמן הריצה
import pino from "pino/browser"
import { isEnabledForNs } from "./namespace.js"
import type { Fields, Level, LogConfig, LogEntry, Logger } from "./types.js"

export { parseLogConfig } from "./config.js"
export type { Fields, Level, LogConfig, LogEntry, Logger }
export { isEnabledForNs }

// ── מצב גלובלי ──────────────────────────────────────────────────────────────

let _config: LogConfig = {
  level: "info",
  ns: "*",
  format: "pretty",
  remote: false,
}

// biome-ignore lint/suspicious/noExplicitAny: pino/browser return type varies
let _pinoInstance: any = null
const _sinks: Array<(entry: LogEntry) => void> = []

// ── חוצץ מרוחק ─────────────────────────────────────────────────────────────

const _buffer: LogEntry[] = []
let _flushTimer: ReturnType<typeof setTimeout> | null = null

function schedule(): void {
  if (_buffer.length >= 50) {
    flush()
  } else if (!_flushTimer) {
    _flushTimer = setTimeout(flush, 250)
  }
}

function flush(): void {
  if (_flushTimer !== null) {
    clearTimeout(_flushTimer)
    _flushTimer = null
  }
  if (_buffer.length === 0) return
  const payload = JSON.stringify({ entries: _buffer.splice(0) })
  // שימוש ב-globalThis כדי להימנע מדרישת ספריות DOM של TS ב-tsconfig של ה-core
  const nav = (globalThis as Record<string, unknown>).navigator as
    | { sendBeacon?: (url: string, data: Blob) => boolean }
    | undefined
  const fetchFn = (globalThis as Record<string, unknown>).fetch as
    | ((url: string, opts: Record<string, unknown>) => Promise<unknown>)
    | undefined
  if (nav?.sendBeacon) {
    nav.sendBeacon("/api/client-log", new Blob([payload], { type: "application/json" }))
  } else if (fetchFn) {
    fetchFn("/api/client-log", { method: "POST", body: payload, keepalive: true }).catch(() => {
      /* שקט — כשלים מרוחקים אינם שוברים את האפליקציה */
    })
  }
}

// רישום handlers לפריקה אם אנחנו בהקשר של דפדפן
const gThis = globalThis as Record<string, unknown>
if (typeof gThis.window !== "undefined") {
  const win = gThis.window as {
    addEventListener: (event: string, handler: () => void) => void
  }
  win.addEventListener("beforeunload", flush)
  win.addEventListener("pagehide", flush)
}

// ── API ציבורי ────────────────────────────────────────────────────────────────

export function initLogger(config: LogConfig): void {
  _config = config

  _pinoInstance = pino({
    level: "trace", // רמת pino מכוונת ל-trace; אנחנו עושים את סינון הרמות בעצמנו
    browser: {
      asObject: true,
      transmit: {
        level: "info",
        // biome-ignore lint/suspicious/noExplicitAny: pino browser logEvent type
        send(level: string, logEvent: any) {
          if (!_config.remote) return
          const bindingsArr: Fields[] = logEvent.bindings ?? []
          const bindings: Fields = Object.assign({}, ...bindingsArr) as Fields
          const ns = (bindings.ns as string | undefined) ?? ""
          const { ns: _ns, ...restFields } = bindings
          void _ns
          const entry: LogEntry = {
            ts: logEvent.ts as number,
            level: level as Level,
            ns,
            msg: String((logEvent.messages as unknown[])[0] ?? ""),
            fields: Object.keys(restFields).length > 0 ? restFields : undefined,
          }
          _buffer.push(entry)
          schedule()
        },
      },
    },
  })
}

export function getLogConfig(): LogConfig {
  return _config
}

export function addSink(sink: (entry: LogEntry) => void): () => void {
  _sinks.push(sink)
  return () => {
    const idx = _sinks.indexOf(sink)
    if (idx >= 0) _sinks.splice(idx, 1)
  }
}

export function createLogger(namespace: string): Logger {
  return makeLogger(namespace, {})
}

// ── פנימי ──────────────────────────────────────────────────────────────────

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

  const instance = _pinoInstance
  if (instance) {
    // ילד pino/browser עם ns מאוגד
    // biome-ignore lint/suspicious/noExplicitAny: pino/browser child is untyped
    const child = (instance as any).child({ ns, ...fields })
    if (level !== "silent") {
      // biome-ignore lint/suspicious/noExplicitAny: pino/browser methods untyped
      ;(child as any)[level](msg ?? "")
    }
  }

  const ts = Date.now()
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
        // שגיאות Sink אינן שוברות את ה-logger
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
