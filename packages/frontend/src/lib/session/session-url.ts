import type { AgentPublic } from "@drive-coding/core/schemas/agent"
import type { SessionTransport } from "./session-transport.js"

export function sessionPath(cliKind: string, sessionId: string): string {
  return `/chat/${encodeURIComponent(cliKind)}/${encodeURIComponent(sessionId)}`
}

/**
 * sessionPathWithTransport — עזר משותף (slice agent-patch-unify, C4 ממצא 2): בונה
 * את נתיב-הניווט כמו `sessionPath`, ומצרף `?sessionTransport=http` באותה צורה שבה
 * connect-agent.ts ו-+page.svelte (handleReconnect) עושים זאת — כדי שרענון (F5)
 * אחרי ניווט מהפאנל לא יאבד את דגל-התעבורה. `sessionId === null` → "/chat" (fallback,
 * כמו בשני האתרים האחרים).
 */
export function sessionPathWithTransport(
  cliKind: string,
  sessionId: string | null,
  transport: SessionTransport,
): string {
  const base = sessionId !== null ? sessionPath(cliKind, sessionId) : "/chat"
  return transport === "http" ? `${base}?sessionTransport=http` : base
}

export type SessionHostPick = { kind: "exact"; agent: AgentPublic } | { kind: "none" }

export function pickSessionHost(
  agents: readonly AgentPublic[],
  cliKind: string,
  sessionId: string,
): SessionHostPick {
  const candidates = agents.filter(
    (a) =>
      a.cliKind === cliKind && a.status !== "crashed" && a.status !== "closed" && !!a.acpSessionId,
  )

  const exact = candidates.find((a) => a.acpSessionId === sessionId)
  if (exact) return { kind: "exact", agent: exact }

  return { kind: "none" }
}
