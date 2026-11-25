import type { Patch, SessionMessage, SessionState } from "./types"

// The map belongs to one immutable message array at a time. Each append transfers
// it to the new array. If an earlier snapshot is used again, it builds its own map.
const indexes = new WeakMap<SessionMessage[], Map<string, number>>()

function messageIndex(messages: SessionMessage[]): Map<string, number> {
  const cached = indexes.get(messages)
  if (cached) return cached
  const index = new Map<string, number>()
  for (const [position, message] of messages.entries()) {
    const { id } = message
    if (!index.has(id)) index.set(id, position)
  }
  indexes.set(messages, index)
  return index
}

export function lookupWireSeqIndex(
  state: SessionState,
  wireSeq: number,
  role?: SessionMessage["role"],
): number {
  const position = messageIndex(state.messages).get(`m_${wireSeq}`)
  if (position === undefined) return -1
  if (role !== undefined && state.messages[position]?.role !== role) return -1
  return position
}

export function wireSeqSlotTaken(state: SessionState, wireSeq: number): boolean {
  return lookupWireSeqIndex(state, wireSeq) !== -1
}

export function syncWireSeqIndex(
  prev: SessionState,
  next: SessionState,
  patch: Patch,
): SessionState {
  const index = indexes.get(prev.messages)
  if (!index || prev.messages === next.messages) return next
  switch (patch.op) {
    case "add-message":
      if (!index.has(patch.message.id)) index.set(patch.message.id, next.messages.length - 1)
      break
    case "append-segment":
    case "update-tool":
      break
    case "set-message":
      if (patch.targetId !== patch.message.id) return next
      break
    default:
      return next
  }
  indexes.delete(prev.messages)
  indexes.set(next.messages, index)
  return next
}
