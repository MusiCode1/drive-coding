/**
 * map-acp-notification.ts — מיפוי טהור SessionNotification (ACP) → ProviderEvent (קנוני).
 *
 * מקור-האמת ל-shapes: agent-session.svelte.ts (#onSessionUpdate:947, #handleToolCall:996,
 * #handleToolCallUpdate:1034, #mapToolContent:855, #mapLocations:895). P1b/§3.
 *
 * שלד Commit 0 — המימוש המלא נכנס ב-Commit 1 (TDD).
 */
import type { SessionNotification } from "@agentclientprotocol/sdk"
import type { ProviderEvent } from "./events.js"

export function mapAcpNotification(_n: SessionNotification): ProviderEvent | null {
  throw new Error("not implemented (Commit 1)")
}
