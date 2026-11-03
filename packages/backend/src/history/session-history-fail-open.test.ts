import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockWarn } = vi.hoisted(() => ({
  mockWarn: vi.fn(),
}))

vi.mock("@drive-coding/core/log", () => ({
  createLogger: () => ({ warn: mockWarn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { WRITE_DB_BUDGET_MS } from "../boot/sqlite-bootstrap.js"
import { runHistoryWriteFailOpen } from "./session-history-fail-open.js"
import { SqliteBusyError, SqliteOpenError } from "./sqlite-adapter.js"

describe("runHistoryWriteFailOpen", () => {
  beforeEach(() => {
    mockWarn.mockClear()
  })

  it("runs fn without logging on success", async () => {
    let n = 0
    runHistoryWriteFailOpen("ok", () => {
      n++
    })
    await Promise.resolve()
    expect(n).toBe(1)
    expect(mockWarn).not.toHaveBeenCalled()
  })

  it("logs and swallows persistent SQLITE_BUSY (no fake success)", async () => {
    let threw = false
    runHistoryWriteFailOpen("busy", () => {
      threw = true
      throw new SqliteBusyError("locked")
    })
    await vi.waitFor(() => expect(mockWarn).toHaveBeenCalled(), {
      timeout: WRITE_DB_BUDGET_MS + 500,
      interval: 20,
    })
    expect(threw).toBe(true)
    expect(mockWarn.mock.calls[0]?.[1]).toMatch(/database locked/)
  })

  it("logs and swallows SqliteOpenError", async () => {
    runHistoryWriteFailOpen("open", () => {
      throw new SqliteOpenError("bad file")
    })
    await vi.waitFor(() => expect(mockWarn).toHaveBeenCalled(), {
      timeout: WRITE_DB_BUDGET_MS + 500,
      interval: 20,
    })
    expect(mockWarn.mock.calls[0]?.[1]).toMatch(/open\/health/)
  })

  it("logs unexpected errors without rethrowing", async () => {
    runHistoryWriteFailOpen("other", () => {
      throw new Error("boom")
    })
    await vi.waitFor(() => expect(mockWarn).toHaveBeenCalled(), {
      timeout: WRITE_DB_BUDGET_MS + 500,
      interval: 20,
    })
    expect(mockWarn.mock.calls[0]?.[1]).toMatch(/unexpected/)
  })
})
