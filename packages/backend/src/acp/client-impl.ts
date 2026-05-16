import type { Client } from "@agentclientprotocol/sdk"

/**
 * Minimal Client implementation passed to ClientSideConnection.
 *
 * Slice 4 strategy:
 * - requestPermission: auto-allow_once (no UI yet)
 * - sessionUpdate: handled externally via onUpdate callback in acp-transport.ts
 * - fs/* / terminal/*: optional, not implemented
 */
export function createClientImpl(opts: {
  onSessionUpdate: (notification: Parameters<NonNullable<Client["sessionUpdate"]>>[0]) => void
}): Client {
  return {
    async requestPermission(params) {
      // Slice 4: auto-allow_once. Slice 5+: forward to UI.
      // Find "allow_once" option (by optionId), fall back to first option.
      const allowOnce = params.options.find((o) => o.optionId === "allow_once")
      const chosen = allowOnce ?? params.options[0]
      if (!chosen) {
        return { outcome: { outcome: "cancelled" } }
      }
      return { outcome: { outcome: "selected", optionId: chosen.optionId } }
    },

    async sessionUpdate(notification) {
      opts.onSessionUpdate(notification)
    },
  }
}
