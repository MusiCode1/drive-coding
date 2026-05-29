/**
 * wire-decode.ts — Passive decode of an NDJSON wire line (one JSON-RPC / ACP frame)
 * into a compact summary for logging.
 *
 * NEVER throws — returns a "raw" summary on parse failure so the caller can
 * still log something without breaking the pipe.
 */

export type WireSummary = {
  /** JSON-RPC method (requests/notifications) if present. */
  method?: string
  /** ACP sessionUpdate type (agent_message_chunk / tool_call / ...) if present. */
  sessionUpdate?: string
  /** JSON-RPC id (request/response correlation) if present. */
  id?: string | number
  /** "result" | "error" for responses; undefined otherwise. */
  responseKind?: "result" | "error"
  /** true when the line was not valid JSON. */
  unparsed: boolean
  /** The parsed object (for trace-level full logging), or undefined if unparsed. */
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
  // ACP session/update notification: params.update.sessionUpdate
  const params = o.params as Record<string, unknown> | undefined
  const upd = params?.update as Record<string, unknown> | undefined
  if (upd && typeof upd.sessionUpdate === "string") summary.sessionUpdate = upd.sessionUpdate
  return summary
}
