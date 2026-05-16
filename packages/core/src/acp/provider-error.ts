/**
 * Pure helper — extract a provider error message from opencode acp stderr.
 *
 * When the LLM provider (Anthropic/Google/etc.) returns 400/401/429 errors,
 * opencode acp sometimes returns `stopReason=end_turn` with an empty message,
 * swallowing the actual error. The real cause is logged to stderr in two
 * possible formats:
 *
 *   1. JSON `"message":"..."` from the AI SDK's AI_APICallError (responseBody).
 *      We accept any string with one of the keywords: credit, invalid,
 *      unauthor, forbid, rate, limit, key.
 *
 *   2. opencode's own ERROR log lines: `ERROR ... error=<text> [stack=...]`.
 *      We extract up to the trailing `stack=` (or end-of-line) and cap at
 *      200 chars.
 *
 * Returns `null` if no recognizable error pattern is found.
 *
 * The function scans the most recent 30 lines (pattern 1) or 50 lines
 * (pattern 2). Used after a prompt returns with 0 chars of `message` —
 * the result is shown to the user as the real cause.
 */
export function extractProviderError(stderrLines: string[]): string | null {
  // Pattern 1: "message":"..." with relevant keyword, scan last 30 lines.
  for (let i = stderrLines.length - 1; i >= 0 && i >= stderrLines.length - 30; i--) {
    const line = stderrLines[i]
    const m = line?.match(/"message":"([^"]{10,400})"/)
    if (m?.[1] && /credit|invalid|unauthor|forbid|rate|limit|key/i.test(m[1])) {
      return m[1]
    }
  }
  // Pattern 2: opencode ERROR log line, scan last 50 lines.
  for (let i = stderrLines.length - 1; i >= 0 && i >= stderrLines.length - 50; i--) {
    const line = stderrLines[i]
    const m = line?.match(/ERROR.*?error=(.+?)(?:\s+stack=|$)/)
    if (m?.[1]) return m[1].slice(0, 200)
  }
  return null
}
