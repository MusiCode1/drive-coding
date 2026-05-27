/**
 * sessions-ws.ts — ACP-over-WS session listing helpers.
 *
 * Two strategies:
 *   1. listSessionsViaActiveAgent — reuse an already-initialized AcpClient.
 *      Caller is responsible for closing the client when done.
 *   2. listSessionsViaTempAgent — spawn a throwaway agent, list, then delete.
 *      Use only on explicit user action — ~300-500ms warm-start cost.
 *
 * Both handle -32601 ("method not found") gracefully: Gemini CLI doesn't
 * implement session/list and returns this error code. Callers get [] instead
 * of a thrown error.
 */

import type { CliKind } from "@drive-coding/core"
import { connectToAgent } from "$lib/acp/connect"
import { createAgent, deleteAgent } from "$lib/api/agents"

export type SessionInfo = {
  sessionId: string
  cwd: string
  title: string
  updatedAt: string
}

/**
 * List sessions via an already-connected ACP client.
 * Returns [] if the CLI doesn't support session/list (Gemini — -32601).
 * Throws on any other error.
 */
export async function listSessionsViaActiveAgent(
  acp: Awaited<ReturnType<typeof connectToAgent>>,
): Promise<SessionInfo[]> {
  try {
    const res = await acp.listSessions()
    const raw = (res as { sessions?: unknown[] }).sessions ?? []
    return raw.map(normalizeSession)
  } catch (e) {
    if ((e as { code?: number }).code === -32601) return []
    throw e
  }
}

/**
 * Spawn a throwaway agent for cwd, call session/list, then delete the agent.
 * Always cleans up (close WS + DELETE agent) even on error.
 *
 * NOTE: Only call this on explicit user interaction. Show a loading spinner
 * before calling — the spawn + ACP handshake takes ~300-700ms.
 */
export async function listSessionsViaTempAgent(
  cwd: string,
  cliKind: CliKind,
): Promise<SessionInfo[]> {
  let tempAgentId: string | null = null
  let acp: Awaited<ReturnType<typeof connectToAgent>> | null = null
  try {
    const { agentId } = await createAgent({ cwd, cliKind })
    tempAgentId = agentId
    // noop session-update handler — we only care about the listSessions response
    acp = await connectToAgent(agentId, () => {})
    return await listSessionsViaActiveAgent(acp)
  } finally {
    try {
      acp?.close()
    } catch {}
    if (tempAgentId) {
      // fire-and-forget — ws-agent.ts detaches pipe; BE kills child on DELETE
      void deleteAgent(tempAgentId).catch(() => {})
    }
  }
}

function normalizeSession(s: unknown): SessionInfo {
  const item = s as Record<string, unknown>
  return {
    sessionId: String(item.sessionId ?? ""),
    cwd: String(item.cwd ?? ""),
    title: String(item.title ?? ""),
    updatedAt: String(item.updatedAt ?? ""),
  }
}
