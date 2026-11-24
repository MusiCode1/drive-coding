import type { AgentPublic } from "@drive-coding/core"
import { withTimeout } from "@drive-coding/core/async/with-timeout"
import { beUrl } from "$lib/util/be-url"

const AGENT_READ_TIMEOUT_MS = 10_000

/** מושך את רשימת הסוכנים הפעילים מה-BE (GET /api/agents). */
export async function listAgents(signal?: AbortSignal): Promise<AgentPublic[]> {
  const res = await withTimeout(
    (s) => fetch(beUrl("/api/agents"), { signal: s }),
    AGENT_READ_TIMEOUT_MS,
    { signal, label: "listAgents" },
  )
  if (!res.ok) throw new Error(`listAgents failed: ${res.status}`)
  const body = (await res.json()) as { agents: AgentPublic[] }
  return body.agents
}

/** Agent metadata, including the recorded cause when its provider has exited. */
export async function getAgent(
  agentId: string,
  signal?: AbortSignal,
  opts?: { baseUrl?: string; fetcher?: (url: string, init?: RequestInit) => Promise<Response> },
): Promise<{ agent: { cwd: string; status: string; crashReason?: string } }> {
  const path = `/api/agents/${encodeURIComponent(agentId)}`
  const url = opts?.baseUrl !== undefined ? `${opts.baseUrl}${path}` : beUrl(path)
  const request = opts?.fetcher ?? fetch
  const res = await withTimeout((s) => request(url, { signal: s }), AGENT_READ_TIMEOUT_MS, {
    signal,
    label: "getAgent",
  })
  if (!res.ok) {
    throw new Error(`getAgent failed: ${res.status}`)
  }
  return (await res.json()) as { agent: { cwd: string; status: string; crashReason?: string } }
}
