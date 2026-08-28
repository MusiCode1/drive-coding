/**
 * join-transport.ts — resolveJoin(): האם לחיצת שקע על סוכן חי מותרת.
 *
 * slice http-join-truth C0: attachedVia חסר/null → התאמה ל-clientTransport
 * (GET /api/agents שולח null כשיש runtime בלי בעלים). שונה → mismatch, בלי attach.
 */

import type { SessionTransport } from "./session-transport.js"

export type JoinDecision =
  | { kind: "ws" }
  | { kind: "http" }
  | { kind: "mismatch" }

export function resolveJoin(
  agent: { attachedVia?: SessionTransport | null },
  clientTransport: SessionTransport,
): JoinDecision {
  const via = agent.attachedVia
  if (via == null) return { kind: clientTransport }
  if (via === clientTransport) return { kind: clientTransport }
  return { kind: "mismatch" }
}
