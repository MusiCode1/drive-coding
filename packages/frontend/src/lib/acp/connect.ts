/**
 * connect.ts — high-level FE helper to connect to an agent via WS+ACP.
 *
 * Constructs a `WsAcpTransport`, registers the close listener, awaits the
 * WS open, then hands the transport to the transport-agnostic `createAcpClient`
 * in `@drive-coding/core/acp`.
 *
 * This is the FE drop-in replacement for the old `createAcpClient(agentId, ...)`
 * that lived in `lib/acp/client.ts`. The signature mirrors the old one so
 * consumers can switch with minimal churn.
 */

import type { SessionNotification } from "@agentclientprotocol/sdk"
import { createAcpClient, type AcpClient } from "@drive-coding/core/acp/client"
import { WsAcpTransport } from "./ws-transport.js"

export async function connectToAgent(
  agentId: string,
  onUpdate: (n: SessionNotification) => void,
  onClose?: (code: number, reason: string) => void,
): Promise<AcpClient> {
  const proto = location.protocol === "https:" ? "wss:" : "ws:"
  const transport = new WsAcpTransport(`${proto}//${location.host}/ws/agent/${agentId}`)

  // Register the close listener BEFORE awaiting open — otherwise an early
  // close (e.g. agent not found → 1008) would fire before we subscribe and
  // the caller would never learn about it.
  if (onClose) transport.onClose(onClose)

  await transport.waitForOpen()
  return createAcpClient(transport, onUpdate)
}
