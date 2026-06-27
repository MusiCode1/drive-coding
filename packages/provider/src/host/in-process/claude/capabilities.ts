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
  // compact, usage, commands: NOT declared in initialize
  // configOptions: comes from session/new, NOT from initialize
}

/**
 * Maps claude's raw agentCapabilities to NormalizedCapabilities.
 *
 * Rules (from brief §3 + findings):
 * - mcp: mcpCapabilities present → true
 * - compact/usage/commands: not declared in initialize → false (runtime features)
 * - configOptions: from session/new only; must not be hardcoded true → false here
 */
export function mapClaudeCapabilities(raw: unknown): NormalizedCapabilities {
  const caps = (raw as { agentCapabilities?: RawAgentCapabilities } | null)?.agentCapabilities

  return {
    mcp: caps?.mcpCapabilities != null,
    compact: false,
    commands: false,
    usage: false,
    configOptions: false,
  }
}
