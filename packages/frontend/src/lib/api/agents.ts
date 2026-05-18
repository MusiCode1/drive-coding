import type { AgentList, AgentPublic, CreateAgentInput } from "@drive-coding/core"
import { clearAgentMetadata, saveAgentMetadata } from "$lib/stores/agent-storage"

const API_BASE = "" // proxy via vite (D45 frontend dev)

/**
 * Slice 10: POST /api/agents response shape (CreateAndSpawnResult).
 * BE no longer does ACP handshake — FE handles it then calls /session-attached.
 */
export type CreateAgentResponse = {
  agentId: string
  cwd: string
  cliKind: string
  wsUrl: string
  bridgePort: number
  status: "spawning" | "ready"
  acpSessionId?: string
}

export async function listAgents(): Promise<AgentList> {
  const res = await fetch(`${API_BASE}/api/agents`)
  if (!res.ok) throw new Error(`listAgents failed: ${res.status}`)
  return res.json()
}

export async function createAgent(input: CreateAgentInput): Promise<CreateAgentResponse> {
  const res = await fetch(`${API_BASE}/api/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? `createAgent failed: ${res.status}`)
  }
  const data = (await res.json()) as CreateAgentResponse
  // F-5: cache agent metadata locally for recovery after BE restart
  saveAgentMetadata({
    agentId: data.agentId,
    cwd: data.cwd,
    cliKind: data.cliKind,
    acpSessionId: data.acpSessionId ?? null,
    modelOverride: input.modelOverride ?? null,
  })
  return data
}

export async function getAgent(id: string): Promise<{ agent: AgentPublic }> {
  const res = await fetch(`${API_BASE}/api/agents/${id}`)
  if (!res.ok) throw new Error(`getAgent failed: ${res.status}`)
  return res.json()
}

export async function deleteAgent(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/agents/${id}`, { method: "DELETE" })
  if (!res.ok) throw new Error(`deleteAgent failed: ${res.status}`)
  // F-5: drop the local cache so we don't try to recover a deliberately-killed agent
  clearAgentMetadata(id)
}

/** Phase 2: notify BE that ACP session handshake succeeded. */
export async function sessionAttached(agentId: string, sessionId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/agents/${agentId}/session-attached`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  })
  if (!res.ok) throw new Error(`sessionAttached failed: ${res.status}`)
}
