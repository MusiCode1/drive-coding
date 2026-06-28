/**
 * wire-decode.ts — פענוח פסיבי של שורת NDJSON (פריים אחד של JSON-RPC / ACP)
 * לסיכום קומפקטי עבור כתיבה ללוג.
 *
 * לעולם לא זורק שגיאה — מחזיר סיכום "גולמי" במקרה של כישלון בפענוח כדי שהקורא
 * יוכל בכל זאת לרשום משהו ללוג בלי לשבור את הצינור (pipe).
 */

export type WireSummary = {
  /** מתודת JSON-RPC (בקשות/התראות) אם קיימת. */
  method?: string
  /** סוג ACP sessionUpdate (agent_message_chunk / tool_call / ...) אם קיים. */
  sessionUpdate?: string
  /** מזהה JSON-RPC (מתאם בין בקשה/תגובה) אם קיים. */
  id?: string | number
  /** "result" | "error" עבור תגובות; undefined אחרת. */
  responseKind?: "result" | "error"
  /** true כאשר השורה אינה JSON תקין. */
  unparsed: boolean
  /** האובייקט המפוענח (עבור לוגים מלאים ברמת trace), או undefined אם לא פוענח. */
  parsed?: unknown
}

export function decodeWireLine(line: string): WireSummary {
  let obj: unknown
  try {
    obj = JSON.parse(line)
  } catch {
    return { unparsed: true }
  }
  if (typeof obj !== "object" || obj === null) {
    return { unparsed: false, parsed: obj }
  }
  const o = obj as Record<string, unknown>
  const summary: WireSummary = { unparsed: false, parsed: obj }
  if (typeof o.method === "string") summary.method = o.method
  if (typeof o.id === "string" || typeof o.id === "number") summary.id = o.id
  if ("result" in o) summary.responseKind = "result"
  else if ("error" in o) summary.responseKind = "error"
  // התראת ACP session/update: params.update.sessionUpdate
  const params = o.params as Record<string, unknown> | undefined
  const upd = params?.update as Record<string, unknown> | undefined
  if (upd && typeof upd.sessionUpdate === "string") summary.sessionUpdate = upd.sessionUpdate
  return summary
}
