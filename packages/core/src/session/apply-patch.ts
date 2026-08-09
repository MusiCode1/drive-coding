/**
 * apply-patch.ts — applyPatch(state, patch) → SessionState טהור (immutable).
 *
 * לטסטים ול-remote (SessionState → SessionState).
 * ה-FE משתמש ב-applyPatchMutable (ב-packages/frontend) שמטפל ב-Bubble[] ישירות.
 *
 * ─── slice session-state-reducer C2 (TDD) ───
 */
import type { Patch, SessionMessage, SessionState, TurnStateValue } from "./types"

/** גוזר nextSeq מ-id בצורת prefix_<n> (m_3 → 4, s_0 → 1). */
function nextSeqFrom(id: string): number {
  const n = parseInt(id.split("_")[1] ?? "0", 10)
  return isNaN(n) ? 0 : n + 1
}

/**
 * applyPatch — טהור, immutable. לכל patch מחזיר SessionState חדש.
 * גם מעדכן nextMessageSeq/nextSegmentSeq מה-ids בpatches (לשמירת עקביות עם reduce).
 * לא זורק — patch על targetId שלא קיים → no-op (מחזיר state ללא שינוי).
 */
export function applyPatch(state: SessionState, patch: Patch): SessionState {
  switch (patch.op) {
    case "add-message": {
      // update message counter
      const nextMsgSeq = Math.max(state.nextMessageSeq, nextSeqFrom(patch.message.id))
      // update segment counter (from segments inside the new message)
      let nextSegSeq = state.nextSegmentSeq
      if (patch.message.role !== "tool") {
        for (const seg of patch.message.segments) {
          nextSegSeq = Math.max(nextSegSeq, nextSeqFrom(seg.id))
        }
      }
      // C1: derive turnState from the message role (mirrors reduce logic)
      const newTurnStateMsg: TurnStateValue =
        patch.message.role === "tool"
          ? "calling-tool"
          : patch.message.role === "thought"
            ? "thinking"
            : patch.message.role === "assistant"
              ? "responding"
              : state.turnState // user = no change
      return {
        ...state,
        version: patch.version,
        messages: [...state.messages, patch.message],
        nextMessageSeq: nextMsgSeq,
        nextSegmentSeq: nextSegSeq,
        turnState: newTurnStateMsg,
      }
    }

    case "append-segment": {
      const idx = state.messages.findIndex((m) => m.id === patch.targetId)
      if (idx === -1) return state
      const old = state.messages[idx]!
      if (old.role === "tool") return state // tool messages have no segments

      const updatedMsg: SessionMessage = {
        ...old,
        segments: [...old.segments, patch.segment],
      }
      const messages = [...state.messages]
      messages[idx] = updatedMsg
      // update segment counter
      const nextSegSeq = Math.max(state.nextSegmentSeq, nextSeqFrom(patch.segment.id))
      // C1: derive turnState from the message role (mirrors reduce logic)
      const newTurnStateSeg: TurnStateValue =
        old.role === "thought"
          ? "thinking"
          : old.role === "assistant"
            ? "responding"
            : state.turnState
      return {
        ...state,
        version: patch.version,
        messages,
        nextSegmentSeq: nextSegSeq,
        turnState: newTurnStateSeg,
      }
    }

    case "update-tool": {
      const idx = state.messages.findIndex((m) => m.id === patch.targetId)
      if (idx === -1) return state
      const old = state.messages[idx]!
      if (old.role !== "tool") return state

      const updatedMsg: SessionMessage = {
        ...old,
        toolCall: { ...old.toolCall, ...patch.toolCall },
      }
      const messages = [...state.messages]
      messages[idx] = updatedMsg
      return { ...state, version: patch.version, messages }
    }

    case "reset": {
      return {
        ...state,
        version: patch.version,
        messages: patch.messages,
        nextMessageSeq: patch.nextMessageSeq,
        nextSegmentSeq: patch.nextSegmentSeq,
      }
    }

    case "update-session": {
      // C1: merge metadata changes into state (immutable)
      return {
        ...state,
        version: patch.version,
        ...patch.changes,
      }
    }

    default: {
      // calev-heavy remote-session-view round 2 finding #1: the switch was
      // exhaustive over the *declared* Patch union but had no terminal branch —
      // wire consumers (SSEReader) parse frames with `JSON.parse(...) as Patch`,
      // an unvalidated cast. A newer BE emitting an `op` this build doesn't know
      // (version skew — the single most likely FE/BE divergence in production)
      // fell off the end of the switch and returned `undefined`, wiping state.
      // Unknown ops are a no-op: keep state unchanged, don't bump version (we
      // didn't actually apply anything).
      return state
    }
  }
}
