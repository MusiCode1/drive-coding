/**
 * client-impl.ts — ACP Client implementation for browser FE
 *
 * Strategy (Phase 2):
 * - requestPermission: auto-allow_once policy (no UI yet — slice future)
 * - sessionUpdate: forwarded to caller via onUpdate callback
 * - fs.readTextFile / writeTextFile: NOT declared (clientCapabilities.fs = false).
 *   opencode reads disk via its own internal tool calls (not ACP fs caps).
 *   Phase 2 smoke test will validate this assumption.
 */
import type { Client, SessionNotification } from "@agentclientprotocol/sdk"

export function createClientImpl(opts: { onUpdate: (n: SessionNotification) => void }): Client {
  return {
    /**
     * Auto-allow_once: prefer allow_once > allow_always > first non-reject > first option.
     * Future slices will add UI prompt for user confirmation.
     */
    async requestPermission(params) {
      const byKind = (k: string) => params.options.find((o) => o.kind === k)
      const chosen =
        byKind("allow_once") ??
        byKind("allow_always") ??
        params.options.find((o) => !o.kind.startsWith("reject")) ??
        params.options[0]

      if (!chosen) {
        return { outcome: { outcome: "cancelled" } }
      }
      return { outcome: { outcome: "selected", optionId: chosen.optionId } }
    },

    async sessionUpdate(notification) {
      opts.onUpdate(notification)
    },

    // fs.readTextFile + writeTextFile: NOT declared.
    // clientCapabilities.fs = { readTextFile: false, writeTextFile: false }
    // opencode uses its own internal fs tool calls — does not need ACP fs caps for MVP.
    // If smoke test fails (opencode sends fs/read_text_file → -32601), open decision.
  }
}
