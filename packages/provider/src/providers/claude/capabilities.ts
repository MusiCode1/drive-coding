/**
 * capabilities.ts — maps claude's initialize agentCapabilities to NormalizedCapabilities.
 *
 * Mapping based on real initialize frame captured by C3-spike (see findings doc).
 * Only what claude actually declares is mapped; undeclared features default false.
 */

import type { NormalizedCapabilities } from "../../types.js"

/**
 * Raw shape of agentCapabilities as returned by claude's initialize response.
 * Only the fields we care about; extra fields are ignored.
 */
interface RawAgentCapabilities {
  mcpCapabilities?: Record<string, unknown>
  // compact, commands: NOT declared in initialize
  // configOptions: comes from session/new, NOT from initialize
}

/**
 * Maps claude's raw agentCapabilities to NormalizedCapabilities.
 *
 * Rules (from brief §3 + findings):
 * - mcp: mcpCapabilities present → true
 * - compact/commands: not declared in initialize → false (runtime features)
 * - configOptions: from session/new only; must not be hardcoded true → false here
 * - rename: true — renameSession() is available via @anthropic-ai/claude-agent-sdk (store-level)
 * - usage: true — slice session-budget-meter Commit 3. Means "claude implements the
 *   _drive/getQuota handler", NOT "this account has visible rate limits". An account
 *   without limits yet still returns { snapshot: null } — that's a valid, supported
 *   response, not unsupported. Store-level (query-access.ts), like rename/thinkingTokens —
 *   not declared in the initialize frame, so not gated on caps?.
 */
export function mapClaudeCapabilities(raw: unknown): NormalizedCapabilities {
  const caps = (raw as { agentCapabilities?: RawAgentCapabilities } | null)?.agentCapabilities

  return {
    mcp: caps?.mcpCapabilities != null,
    compact: false,
    commands: false,
    usage: true,
    configOptions: false,
    rename: true,
    thinkingTokens: true,
    // image: safe default; slice reattach-state-sync's init-frame tap (extractPromptCaps)
    // is the source of truth, not a per-provider hardcode.
    image: false,
    // claude injects opts.systemPrompt via _meta.systemPrompt.append (connect-in-process.ts)
    systemPrompt: "native",
  }
}
