/**
 * connection-registry-charter.ts — ConnEntry charter helpers (slice agent-charter C2).
 */

import type { ConnectOpts, ProviderConnection } from "@drive-coding/provider/connection"
import { applyCharterAtConnect } from "../session-host/session-host-charter.js"

/** ConnEntry charter fields from connect() — caps flip to prepended when stored. */
export function connCharterAtConnect(
  conn: ProviderConnection,
  systemPrompt: ConnectOpts["systemPrompt"],
): { charter?: string } {
  return applyCharterAtConnect(conn, systemPrompt)
}

/** Read stored charter without consuming. */
export function getConnCharter(entry: { charter?: string } | undefined): string | undefined {
  return entry?.charter
}

/** Return stored charter once, then clear it. */
export function consumeConnCharter(entry: { charter?: string } | undefined): string | undefined {
  if (entry?.charter === undefined) return undefined
  const text = entry.charter
  delete entry.charter
  return text
}
