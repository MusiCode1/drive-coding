/**
 * token-usage-patch-wire.ts — subscribe to PatchesBroadcaster for contextUsage (C3).
 */

import type { Patch } from "@drive-coding/core/session"
import type { ConnectionRegistry } from "../acp/connection-registry.js"
import type { ExtendedSessionHost } from "../session-host/session-host.js"
import type { PatchesBroadcaster } from "../session-host/patches-broadcaster.js"
import type { TokenUsageStore } from "./token-usage-store.js"

function contextFromPatch(patch: Patch): {
  used: number
  size: number
  cost?: { amount: number; currency?: string }
} | null {
  if (patch.op !== "update-session") return null
  const cu = patch.changes.contextUsage
  if (!cu || typeof cu.used !== "number" || typeof cu.size !== "number") return null
  const cost =
    cu.cost && typeof cu.cost === "object" && typeof cu.cost.amount === "number"
      ? {
          amount: cu.cost.amount,
          ...(typeof cu.cost.currency === "string" ? { currency: cu.cost.currency } : {}),
        }
      : typeof cu.cost === "number"
        ? { amount: cu.cost }
        : undefined
  return { used: cu.used, size: cu.size, ...(cost !== undefined ? { cost } : {}) }
}

/** Starts a background reader; ends when the broadcaster closes the stream. */
export function wireTokenUsagePatches(
  agentId: string,
  host: ExtendedSessionHost,
  broadcaster: PatchesBroadcaster,
  getStore: () => TokenUsageStore | null,
  connectionRegistry: ConnectionRegistry,
): void {
  const stream = broadcaster.subscribe()
  void (async () => {
    const reader = stream.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const ctx = contextFromPatch(value)
        if (ctx === null) continue
        const store = getStore()
        if (store === null) continue
        store.ingestUsageUpdate({
          agentId,
          acpSessionId: host.state.sessionId,
          cliKind: connectionRegistry.getCliKind(agentId) ?? "unknown",
          cwd: connectionRegistry.getCwd(agentId) ?? "",
          ...ctx,
        })
      }
    } catch {
      // broadcaster closed
    } finally {
      reader.releaseLock()
    }
  })()
}
