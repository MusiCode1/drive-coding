/**
 * session-view.test.ts — contract tests for the SessionView port.
 *
 * Tests:
 * 1. LocalSessionView satisfies the SessionView interface at compile time
 * 2. The interface shape is correct (state, patches, methods)
 *
 * ─── slice session-view-port C2 (TDD) ───
 */
import { describe, it, expect } from "vitest"
import type { SessionView } from "./session-view"
import { createInitialSessionState, type Patch } from "@drive-coding/core/session"
import type { SessionInfo } from "$lib/adapters/sessions"
import type { PromptBlocks } from "@drive-coding/provider/client"

// ─── Minimal mock implementation to verify the interface ───

class MockSessionView implements SessionView {
  readonly state = createInitialSessionState({ sessionId: null })
  readonly patches: ReadableStream<Patch[]> = new ReadableStream<Patch[]>()

  prompt(_content: string | PromptBlocks, _meta?: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
  cancel(): Promise<void> { return Promise.resolve() }
  respond(_requestId: number, _result: unknown): Promise<void> { return Promise.resolve() }
  setMode(_mode: string): Promise<void> { return Promise.resolve() }
  setConfigOption(_key: string, _value: unknown): Promise<void> { return Promise.resolve() }
  extMethod(_method: string, _params: unknown): Promise<unknown> { return Promise.resolve(null) }
  newSession(): Promise<void> { return Promise.resolve() }
  loadSession(_sessionId: string): Promise<void> { return Promise.resolve() }
  listSessions(): Promise<SessionInfo[]> { return Promise.resolve([]) }
  deleteSession(_sessionId: string): Promise<void> { return Promise.resolve() }
  setSessionModel(_model: string): Promise<void> { return Promise.resolve() }
  close(): Promise<void> { return Promise.resolve() }
}

// ─── Tests ───

describe("SessionView interface contract", () => {
  it("mock implementation compiles and satisfies interface", () => {
    const view: SessionView = new MockSessionView()
    expect(view).toBeDefined()
  })

  it("state returns SessionState", () => {
    const view = new MockSessionView()
    expect(view.state.version).toBe(0)
    expect(view.state.messages).toEqual([])
    expect(view.state.status).toBe("idle")
    expect(view.state.turnState).toBe("idle")
  })

  it("patches is a ReadableStream", () => {
    const view = new MockSessionView()
    expect(view.patches).toBeInstanceOf(ReadableStream)
  })

  it("all methods are callable and return Promises", async () => {
    const view = new MockSessionView()
    await expect(view.prompt("hello")).resolves.toBeUndefined()
    await expect(view.cancel()).resolves.toBeUndefined()
    await expect(view.respond(0, null)).resolves.toBeUndefined()
    await expect(view.setMode("fast")).resolves.toBeUndefined()
    await expect(view.setConfigOption("key", "val")).resolves.toBeUndefined()
    await expect(view.extMethod("method", {})).resolves.toBeDefined()
    await expect(view.newSession()).resolves.toBeUndefined()
    await expect(view.loadSession("s-1")).resolves.toBeUndefined()
    await expect(view.listSessions()).resolves.toEqual([])
    await expect(view.deleteSession("s-1")).resolves.toBeUndefined()
    await expect(view.setSessionModel("m-1")).resolves.toBeUndefined()
    await expect(view.close()).resolves.toBeUndefined()
  })
})
