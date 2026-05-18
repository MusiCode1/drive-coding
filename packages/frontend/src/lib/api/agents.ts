import type { AgentList, AgentPublic, CreateAgentInput } from "@drive-coding/core"

const API_BASE = "" // proxy via vite (D45 frontend dev)

export async function listAgents(): Promise<AgentList> {
  const res = await fetch(`${API_BASE}/api/agents`)
  if (!res.ok) throw new Error(`listAgents failed: ${res.status}`)
  return res.json()
}

export async function createAgent(input: CreateAgentInput): Promise<{ agent: AgentPublic }> {
  const res = await fetch(`${API_BASE}/api/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? `createAgent failed: ${res.status}`)
  }
  return res.json()
}

export async function getAgent(id: string): Promise<{ agent: AgentPublic }> {
  const res = await fetch(`${API_BASE}/api/agents/${id}`)
  if (!res.ok) throw new Error(`getAgent failed: ${res.status}`)
  return res.json()
}

export async function deleteAgent(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/agents/${id}`, { method: "DELETE" })
  if (!res.ok) throw new Error(`deleteAgent failed: ${res.status}`)
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
