import type { Patch, SessionMessage, SessionState } from "./types"

const MSG_ID = /^m_(\d+)$/

/** Parse `m_<n>` → n. Returns undefined for non-wire ids. */
export function parseMessageWireSeq(id: string): number | undefined {
  const m = MSG_ID.exec(id)
  if (!m) return undefined
  const n = Number(m[1])
  return Number.isFinite(n) ? n : undefined
}

export function rebuildWireSeqIndex(messages: SessionMessage[]): Record<number, number> {
  const index: Record<number, number> = {}
  for (let i = 0; i < messages.length; i++) {
    const seq = parseMessageWireSeq(messages[i]!.id)
    if (seq !== undefined) index[seq] = i
  }
  return index
}

/** O(1) lookup with role check; returns -1 when not found. */
export function lookupWireSeqIndex(
  state: SessionState,
  wireSeq: number,
  role?: SessionMessage["role"],
): number {
  const idx = state.wireSeqIndex?.[wireSeq]
  if (idx === undefined) return -1
  const msg = state.messages[idx]
  if (msg === undefined) return -1
  if (msg.id !== `m_${wireSeq}`) return -1
  if (role !== undefined && msg.role !== role) return -1
  return idx
}

export function wireSeqSlotTaken(state: SessionState, wireSeq: number): boolean {
  return lookupWireSeqIndex(state, wireSeq) !== -1
}

export function syncWireSeqIndex(
  prev: SessionState,
  next: SessionState,
  patch: Patch,
): SessionState {
  switch (patch.op) {
    case "add-message": {
      const seq = parseMessageWireSeq(patch.message.id)
      if (seq === undefined) {
        return next.messages.length === prev.messages.length
          ? next
          : { ...next, wireSeqIndex: rebuildWireSeqIndex(next.messages) }
      }
      const base = prev.wireSeqIndex ?? rebuildWireSeqIndex(prev.messages)
      const idx = next.messages.length - 1
      return { ...next, wireSeqIndex: { ...base, [seq]: idx } }
    }
    case "reset":
      return { ...next, wireSeqIndex: rebuildWireSeqIndex(next.messages) }
    case "set-message": {
      const prevIdx = prev.messages.findIndex((m) => m.id === patch.targetId)
      if (prevIdx === -1) return next
      const nextIdx = next.messages.findIndex((m) => m.id === patch.targetId)
      if (nextIdx === -1) return next
      const oldSeq = parseMessageWireSeq(prev.messages[prevIdx]!.id)
      const newSeq = parseMessageWireSeq(patch.message.id)
      if (oldSeq === newSeq && next.messages.length === prev.messages.length && prev.wireSeqIndex) {
        return { ...next, wireSeqIndex: prev.wireSeqIndex }
      }
      return { ...next, wireSeqIndex: rebuildWireSeqIndex(next.messages) }
    }
    case "append-segment":
    case "update-tool":
      return prev.wireSeqIndex && next.messages.length === prev.messages.length
        ? { ...next, wireSeqIndex: prev.wireSeqIndex }
        : next
    default:
      return next.messages === prev.messages
        ? next
        : next.messages.length === prev.messages.length && prev.wireSeqIndex
          ? { ...next, wireSeqIndex: prev.wireSeqIndex }
          : { ...next, wireSeqIndex: rebuildWireSeqIndex(next.messages) }
  }
}

export function syncWireSeqIndexRaw(
  prev: SessionState,
  next: SessionState,
  mode: "add" | "rebuild",
  added?: SessionMessage,
): SessionState {
  if (next.messages === prev.messages) return next
  if (mode === "add" && added) {
    const seq = parseMessageWireSeq(added.id)
    if (seq === undefined) return { ...next, wireSeqIndex: rebuildWireSeqIndex(next.messages) }
    const base = prev.wireSeqIndex ?? rebuildWireSeqIndex(prev.messages)
    return { ...next, wireSeqIndex: { ...base, [seq]: next.messages.length - 1 } }
  }
  return { ...next, wireSeqIndex: rebuildWireSeqIndex(next.messages) }
}
