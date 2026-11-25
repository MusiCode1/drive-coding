import type { Patch, SessionState } from "@drive-coding/core/session"
import type { ViewEmission, ViewTerminal } from "./session-view"

export function enqueueEmission(
  ctrl: ReadableStreamDefaultController<ViewEmission> | null,
  emission: ViewEmission,
): void {
  try {
    ctrl?.enqueue(emission)
  } catch {
    // stream cancelled by consumer — ignore
  }
}

export function emitView(
  ctrl: ReadableStreamDefaultController<ViewEmission> | null,
  patches: Patch[],
  updates: unknown[] = [],
  terminal?: ViewTerminal,
): void {
  enqueueEmission(ctrl, { patches, updates, ...terminal })
}

export function advanceReadWaterMark(
  state: SessionState,
  patch: Patch,
): { messageId: string | null; segmentIndex: number } | null {
  if (patch.op !== "append-segment") return null
  const msg = state.messages.find((m) => m.id === patch.targetId)
  if (!msg || msg.role === "tool") return null
  return { messageId: msg.id, segmentIndex: msg.segments.length - 1 }
}
