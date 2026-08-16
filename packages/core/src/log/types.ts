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
  /**
   * מרחבי-שם שנרשמים **בכל רמה**, בנוסף ל-ns/level הרגילים ומבלי להחליף אותם.
   *
   * 🔴 נולד מבאג אמיתי: `LOG_WIRE=acp` היה **דורס** את `ns` ל-"backend.acp.wire.*",
   * וכך מכבה בשקט את כל שאר הלוגים של ה-BE. קיצור-דרך שנועד להוסיף נראוּת הסיר
   * אותה, וכשל-spawn אמיתי נשאר בלי שום שורה שתסביר אותו.
   */
  traceNs?: string
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
