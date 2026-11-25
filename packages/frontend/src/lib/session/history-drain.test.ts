import { createInitialSessionState, type SessionState } from "@drive-coding/core/session"
import { expect, it, vi } from "vitest"
import { drainHistoryUpdates, HistoryGate } from "./history-drain"
import type { HistorySyncPort } from "./history-sync-port"
import { defaultWindow } from "./history-window"
import type { WireUpdateBatch } from "./wire/frame-decode"

it("warns and continues to the next batch if applying a batch throws", async () => {
  let state: SessionState = createInitialSessionState({ sessionId: "drain" })
  const emit = vi.fn()
  const warn = vi.fn()
  const fault = new Error("fixture failure")
  const port: HistorySyncPort = {
    getState: () => state,
    getLastVersion: () => state.version,
    getSessionId: () => state.sessionId,
    setSessionId() {},
    replace: (next) => {
      if (next.version === 1) throw fault
      state = next
    },
    emit,
    warn,
    reconnected() {},
    resetReadMark() {},
    advanceWaterMark() {},
  }
  const stream = new ReadableStream<WireUpdateBatch>({
    start(controller) {
      for (const version of [1, 2]) {
        controller.enqueue({
          version,
          updates: [
            {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: String(version) },
            },
          ],
        })
      }
      controller.close()
    },
  })
  await drainHistoryUpdates(
    stream,
    port,
    new HistoryGate(),
    () => defaultWindow(0),
    () => 0,
    new Set(),
    new AbortController().signal,
    () => true,
    () => {},
  )
  expect(warn).toHaveBeenCalledExactlyOnceWith("history-batch-apply-failed", { error: fault })
  expect(emit).toHaveBeenCalledOnce()
  expect(state.version).toBe(2)
})
