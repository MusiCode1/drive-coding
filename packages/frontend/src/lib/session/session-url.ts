import type { AgentPublic } from "@drive-coding/core/schemas/agent"

export function sessionPath(cliKind: string, sessionId: string): string {
  return `/chat/${encodeURIComponent(cliKind)}/${encodeURIComponent(sessionId)}`
}

export type SessionHostPick =
  | { kind: "exact"; agent: AgentPublic }
  | { kind: "warm"; agent: AgentPublic }
  | { kind: "none" }

export function pickSessionHost(
  agents: readonly AgentPublic[],
  cliKind: string,
  sessionId: string,
): SessionHostPick {
  const candidates = agents.filter(
    (a) =>
      a.cliKind === cliKind &&
      a.status !== "crashed" &&
      a.status !== "closed" &&
      !!a.acpSessionId,
  )

  const exact = candidates.find((a) => a.acpSessionId === sessionId)
  if (exact) return { kind: "exact", agent: exact }

  if (candidates.length === 0) return { kind: "none" }

  const sorted = [...candidates].sort((a, b) => {
    const aAttached = a.attached === true ? 1 : 0
    const bAttached = b.attached === true ? 1 : 0
    if (aAttached !== bAttached) return aAttached - bAttached

    const aTime = a.lastMessageAt ?? 0
    const bTime = b.lastMessageAt ?? 0
    return bTime - aTime
  })

  return { kind: "warm", agent: sorted[0]! }
}
