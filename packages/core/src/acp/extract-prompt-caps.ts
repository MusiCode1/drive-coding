/**
 * extract-prompt-caps.ts — pure structural extraction of promptCapabilities from a
 * decoded JSON-RPC frame (slice reattach-state-sync, Commit 1).
 *
 * Identifies an initialize **response** structurally, not by `method` (a JSON-RPC
 * result response has no `method` field): `parsed.result.agentCapabilities.promptCapabilities`
 * present. Notifications (have `method`) and error responses (have `error`, no `result`)
 * naturally fail this structural check and yield undefined.
 *
 * §9 Q3 — stores the *whole* promptCapabilities object, not just `image`: future fields
 * (audio/embeddedContext) ride the same tap without touching this function again.
 */

export type PromptCapabilities = Record<string, unknown> & { image?: boolean }

export function extractPromptCaps(parsed: unknown): PromptCapabilities | undefined {
  if (typeof parsed !== "object" || parsed === null) return undefined
  const o = parsed as Record<string, unknown>
  const result = o.result
  if (typeof result !== "object" || result === null) return undefined
  const agentCapabilities = (result as Record<string, unknown>).agentCapabilities
  if (typeof agentCapabilities !== "object" || agentCapabilities === null) return undefined
  const promptCapabilities = (agentCapabilities as Record<string, unknown>).promptCapabilities
  if (typeof promptCapabilities !== "object" || promptCapabilities === null) return undefined
  return promptCapabilities as PromptCapabilities
}
