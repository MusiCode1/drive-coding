/**
 * apply-patch.ts — applyPatch(state, patch) → SessionState טהור (immutable).
 *
 * לטסטים ול-remote (SessionState → SessionState).
 * ה-FE משתמש ב-applyPatchMutable (ב-packages/frontend) שמטפל ב-Bubble[] ישירות.
 *
 * ─── slice session-state-reducer C2 (TDD) ───
 */
import type { SessionState, SessionMessage, Patch } from "./types"

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
      return {
        ...state,
        version: patch.version,
        messages: [...state.messages, patch.message],
        nextMessageSeq: nextMsgSeq,
        nextSegmentSeq: nextSegSeq,
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
      return { ...state, version: patch.version, messages, nextSegmentSeq: nextSegSeq }
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
  }
}
