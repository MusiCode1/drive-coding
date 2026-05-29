export type Level = "silent" | "error" | "warn" | "info" | "debug" | "trace"
export type Fields = Record<string, unknown>

export type LogEntry = {
  ts: number
  level: Level
  ns: string
  msg?: string
  fields?: Fields
}

export type LogConfig = {
  level: Level
  ns: string // תבנית CSV; "*" כברירת מחדל
  format: "pretty" | "json" | "both"
  remote?: boolean
}

export interface Logger {
  trace(fields?: Fields, msg?: string): void
  debug(fields?: Fields, msg?: string): void
  info(fields?: Fields, msg?: string): void
  warn(fields?: Fields, msg?: string): void
  error(fieldsOrErr?: Fields | Error, msg?: string): void
  /** צור logger ילד עם שדות שעוברים בירושה. */
  child(fields: Fields): Logger
  /** צור logger של תת-מרחב שם. log.ns("stt") על "voice" → "voice.stt" */
  ns(suffix: string): Logger
}
