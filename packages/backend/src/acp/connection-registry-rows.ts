/**
 * connection-registry-rows.ts — derive attached/via/lastSeenAt from the connection set.
 */
import type { ConnectionVia } from "./connection-registry.js"

export type ConnectionSetEntry = {
  connections: Map<string, { via: ConnectionVia; lastSeenAt: number }>
  attached: boolean
}

export function syncAttached(e: ConnectionSetEntry): void {
  e.attached = e.connections.size > 0
}

export function deriveVia(e: ConnectionSetEntry): ConnectionVia | null {
  for (const row of e.connections.values()) {
    if (row.via === "ws") return "ws"
  }
  for (const row of e.connections.values()) {
    if (row.via === "http") return "http"
  }
  return null
}

export function deriveLastSeenAt(e: ConnectionSetEntry): number | null {
  if (e.connections.size === 0) return null
  let max = 0
  for (const row of e.connections.values()) {
    if (row.lastSeenAt > max) max = row.lastSeenAt
  }
  return max
}
