import type { Level, LogConfig } from "./types.js"

const VALID_LEVELS: Level[] = ["silent", "error", "warn", "info", "debug", "trace"]

function isValidLevel(v: unknown): v is Level {
  return typeof v === "string" && (VALID_LEVELS as string[]).includes(v)
}

type ParseEnv = {
  LOG_LEVEL?: string
  LOG_NS?: string
  LOG_FORMAT?: string
}

/**
 * parseLogConfig — מיזוג הגדרות ממספר מקורות בסדר עדיפות:
 *   URL params  >  localStorage (FE) / env (BE)  >  defaults
 *
 * @param opts.env        — process.env או דומה (עבור BE / בדיקות)
 * @param opts.search     — מחרוזת URL search (עבור FE / בדיקות)
 * @param opts.localStorage — אובייקט דמוי localStorage (עבור FE / בדיקות)
 */
export function parseLogConfig(opts: {
  env?: ParseEnv
  search?: string
  localStorage?: { getItem(key: string): string | null; setItem(key: string, v: string): void }
  defaults?: Partial<LogConfig>
}): LogConfig {
  const defaults: LogConfig = {
    level: "info",
    ns: "*",
    format: "both",
    remote: false,
    ...opts.defaults,
  }

  // שכבה 1: env (BE) או localStorage (FE)
  let level: Level = defaults.level
  let ns: string = defaults.ns
  let format: LogConfig["format"] = defaults.format
  let remote: boolean = defaults.remote ?? false

  if (opts.env) {
    if (isValidLevel(opts.env.LOG_LEVEL)) level = opts.env.LOG_LEVEL
    if (opts.env.LOG_NS) ns = opts.env.LOG_NS
    if (
      opts.env.LOG_FORMAT === "pretty" ||
      opts.env.LOG_FORMAT === "json" ||
      opts.env.LOG_FORMAT === "both"
    ) {
      format = opts.env.LOG_FORMAT
    }
  }

  if (opts.localStorage) {
    const lsLevel = opts.localStorage.getItem("LOG_LEVEL")
    const lsNs = opts.localStorage.getItem("LOG_NS")
    const lsFormat = opts.localStorage.getItem("LOG_FORMAT")
    const lsRemote = opts.localStorage.getItem("LOG_REMOTE")
    if (isValidLevel(lsLevel)) level = lsLevel
    if (lsNs) ns = lsNs
    if (lsFormat === "pretty" || lsFormat === "json" || lsFormat === "both") format = lsFormat
    if (lsRemote === "1") remote = true
  }

  // שכבה 2: URL search params (עדיפות גבוהה ביותר)
  if (opts.search) {
    const params = new URLSearchParams(opts.search)
    const urlLevel = params.get("log")
    const urlNs = params.get("logNs")
    const urlFormat = params.get("logFormat")
    const urlRemote = params.get("logRemote")
    const urlSticky = params.get("logSticky") === "1"

    if (isValidLevel(urlLevel)) {
      level = urlLevel
      if (urlSticky && opts.localStorage) opts.localStorage.setItem("LOG_LEVEL", urlLevel)
    }
    if (urlNs) {
      ns = urlNs
      if (urlSticky && opts.localStorage) opts.localStorage.setItem("LOG_NS", urlNs)
    }
    if (urlFormat === "pretty" || urlFormat === "json" || urlFormat === "both") {
      format = urlFormat
      if (urlSticky && opts.localStorage) opts.localStorage.setItem("LOG_FORMAT", urlFormat)
    }
    if (urlRemote === "1") {
      remote = true
      if (urlSticky && opts.localStorage) opts.localStorage.setItem("LOG_REMOTE", "1")
    }
  }

  return { level, ns, format, remote }
}

/**
 * parseEnvConfig — נוחות עבור Node.js backend.
 * קורא מ-process.env; תומך בקיצור הדרך LOG_WIRE.
 */
export function parseEnvConfig(): LogConfig {
  const env = process.env as ParseEnv
  const config = parseLogConfig({ env, defaults: { format: "both" } })

  // קיצור דרך LOG_WIRE
  const wireMode = process.env.LOG_WIRE
  if (wireMode) {
    config.level = "trace"
    const wireNs: Record<string, string> = {
      acp: "backend.acp.wire.*",
      ws: "backend.ws.wire.*",
      "1": "backend.acp.wire.*,backend.ws.wire.*",
    }
    const addNs = wireNs[wireMode] ?? ""
    if (addNs) {
      config.ns = config.ns === "*" ? addNs : `${config.ns},${addNs}`
    }
  }

  return config
}
