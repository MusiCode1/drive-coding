// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest"
import { bindHistory, HistoryState } from "./history-state.svelte"

function mockController(
  overrides: Partial<{
    hasMore: boolean
    reloading: boolean
    error: string | null
  }> = {},
) {
  return {
    window: {
      firstSeq: 1,
      lastSeq: 10,
      hasMore: overrides.hasMore ?? true,
      watermark: 0,
    },
    error: overrides.error ?? null,
    reloading: overrides.reloading ?? false,
    loadFull: vi.fn(async () => {}),
    retry: vi.fn(async () => {}),
  }
}

describe("HistoryState", () => {
  it("bindHistory copies controller window and clears on resetFields", () => {
    const state = new HistoryState()
    const ctrl = mockController()
    bindHistory(state, { history: ctrl })
    expect(state.window.hasMore).toBe(true)
    state.resetFields()
    expect(state.window.hasMore).toBe(false)
    expect(state.error).toBeNull()
    expect(state.reloading).toBe(false)
  })

  it("applyEmission updates window/error/reloading", () => {
    const state = new HistoryState()
    state.applyEmission({
      window: { firstSeq: 2, lastSeq: 8, hasMore: false, watermark: 1 },
      error: "boom",
      reloading: true,
    })
    expect(state.window.lastSeq).toBe(8)
    expect(state.error).toBe("boom")
    expect(state.reloading).toBe(true)
  })

  it("loadFull and retry delegate to bound controller", async () => {
    const state = new HistoryState()
    const ctrl = mockController()
    bindHistory(state, { history: ctrl })
    await state.loadFull()
    await state.retry()
    expect(ctrl.loadFull).toHaveBeenCalledOnce()
    expect(ctrl.retry).toHaveBeenCalledOnce()
  })
})
