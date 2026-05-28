/**
 * agents-api.ts — minimal REST client for /api/agents.
 *
 * Just enough to support: create agent, get agent info, delete agent.
 * No retries, no schema validation — fast path for v2.
 */

import type { CliKind } from "@drive-coding/core"

export type CreateAgentInput = {
  cwd: string
  cliKind: CliKind
  modelOverride?: string | null
  existingSessionId?: string
}

export type CreateAgentResponse = {
  agentId: string
  acpSessionId?: string
  status: string
}

export async function createAgent(input: CreateAgentInput): Promise<CreateAgentResponse> {
  const res = await fetch("/api/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`createAgent failed: ${res.status} ${body}`)
  }
  return (await res.json()) as CreateAgentResponse
}

export async function getAgent(agentId: string): Promise<{ agent: { cwd: string; status: string } }> {
  const res = await fetch(`/api/agents/${agentId}`)
  if (!res.ok) {
    throw new Error(`getAgent failed: ${res.status}`)
  }
  return (await res.json()) as { agent: { cwd: string; status: string } }
}

export async function notifySessionAttached(agentId: string, sessionId: string): Promise<void> {
  await fetch(`/api/agents/${agentId}/session-attached`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  })
}
