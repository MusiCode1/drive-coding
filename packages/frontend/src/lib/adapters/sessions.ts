/**
 * sessions.ts — adapter for listing ACP sessions.
 *
 * Uses a throwaway agent (spawn → listSessions → delete) so the caller
 * doesn't need an active ACP connection.
 *
 * Cost: ~300-700ms (spawn + ACP handshake + listSessions + delete).
 * Only call on explicit user interaction — always show a spinner first.
 */

import type { CliKind } from "@drive-coding/core"
import { createAcpClient } from "@drive-coding/core/acp/client"
import { WsAcpTransport } from "$lib/engines/ws-transport"
import { createAgent, deleteAgent } from "$lib/adapters/agents-api"
import { beWsUrl } from "$lib/util/be-url"

export type SessionInfo = {
  sessionId: string
  cwd: string
  title: string // empty string if CLI doesn't return a title
  updatedAt: string // ISO timestamp (or empty string if missing)
}

/**
 * List sessions for a (cwd, cliKind) combo by spawning a throwaway agent,
 * calling ACP listSessions, then deleting the agent.
 *
 * Returns [] if:
 *   - CLI doesn't support session/list (-32601, e.g. Gemini)
 *   - No previous sessions exist for this cwd
 *
 * Throws on:
 *   - Failed spawn (cwd doesn't exist, binary missing)
 *   - Network errors
 */
export async function listSessionsForCwd(cwd: string, cliKind: CliKind): Promise<SessionInfo[]> {
  let tempAgentId: string | null = null
  let acp: Awaited<ReturnType<typeof createAcpClient>> | null = null

  try {
    // 1. Spawn a throwaway agent
    const { agentId } = await createAgent({ cwd, cliKind })
    tempAgentId = agentId

    // 2. Open WS transport + ACP handshake
    const transport = new WsAcpTransport(beWsUrl(`/ws/agent/${agentId}`))
    await transport.waitForOpen()

    // noop update handler — only care about listSessions response
    acp = await createAcpClient(transport, () => {})

    // 3. Call listSessions
    try {
      const res = await acp.listSessions()
      const raw = (res as { sessions?: unknown[] }).sessions ?? []
      return raw.map(normalizeSession)
    } catch (e) {
      // -32601 = method not found (e.g. Gemini doesn't support listSessions)
      if ((e as { code?: number }).code === -32601) return []
      throw e
    }
  } finally {
    // Always clean up: close WS first, then fire-and-forget DELETE
    try {
      acp?.close()
    } catch {
      // already closed
    }
    if (tempAgentId !== null) {
      // fire-and-forget: BE kills child on DELETE; WS already closed above
      void deleteAgent(tempAgentId).catch(() => {})
    }
  }
}

function normalizeSession(s: unknown): SessionInfo {
  const item = s as Record<string, unknown>
  return {
    sessionId: String(item["sessionId"] ?? ""),
    cwd: String(item["cwd"] ?? ""),
    title: String(item["title"] ?? ""),
    updatedAt: String(item["updatedAt"] ?? ""),
  }
}
