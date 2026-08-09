/**
 * mock-session-view.svelte.ts — MockSessionView test helper.
 *
 * מימוש מינימלי של SessionView לטסטים של AgentSession (C3).
 * חושף `fireUpdate(update)` לסימולציה של session/update events.
 *
 * ─── slice session-view-port C3 (test helper) ───
 */
import { reduce, createInitialSessionState, type SessionState, type Patch } from "@drive-coding/core/session"
import type { SessionView } from "$lib/session/session-view"
import type { SessionInfo } from "$lib/adapters/sessions"
import type { PromptBlocks } from "@drive-coding/provider/client"
import { vi } from "vitest"

export class MockSessionView implements SessionView {
  // ─── state (plain object, updated by fireUpdate) ───
  state: SessionState = $state(createInitialSessionState({ sessionId: null }))

  // ─── patches stream ───
  #controller: ReadableStreamDefaultController<Patch[]> | null = null
  readonly patches: ReadableStream<Patch[]>

  // Track calls for assertions
  readonly promptMock = vi.fn<[string | PromptBlocks, Record<string, unknown>?], Promise<void>>()
    .mockResolvedValue(undefined)
  readonly cancelMock = vi.fn().mockResolvedValue(undefined)
  readonly newSessionMock = vi.fn().mockResolvedValue(undefined)
  readonly loadSessionMock = vi.fn().mockResolvedValue(undefined)
  readonly closeMock = vi.fn().mockResolvedValue(undefined)
  readonly respondMock = vi.fn().mockResolvedValue(undefined)
  readonly setModeMock = vi.fn().mockResolvedValue(undefined)
  readonly setConfigOptionMock = vi.fn().mockResolvedValue(undefined)
  readonly extMethodMock = vi.fn().mockResolvedValue(undefined)
  readonly listSessionsMock = vi.fn<[], Promise<SessionInfo[]>>().mockResolvedValue([])
  readonly deleteSessionMock = vi.fn().mockResolvedValue(undefined)
  readonly setSessionModelMock = vi.fn().mockResolvedValue(undefined)

  constructor() {
    this.patches = new ReadableStream<Patch[]>({
      start: (controller) => {
        this.#controller = controller
      },
    })
  }

  // ─── Test helper: fire a session/update ───

  /**
   * מדמה session/update notification:
   * מריץ reduce, מעדכן state, ודוחף patches לstream.
   */
  fireUpdate(update: unknown): void {
    const { state, patches } = reduce(this.state, update)
    this.state = state
    if (patches.length > 0) {
      try {
        this.#controller?.enqueue(patches)
      } catch {
        // stream closed
      }
    }
  }

  /**
   * מגדיר sessionId (מדמה חיבור מוצלח).
   */
  connect(sessionId: string): void {
    this.state = {
      ...this.state,
      sessionId,
      status: "connected",
    }
  }

  // ─── SessionView interface ───

  prompt(content: string | PromptBlocks, meta?: Record<string, unknown>): Promise<void> {
    return this.promptMock(content, meta)
  }
  cancel(): Promise<void> { return this.cancelMock() }
  respond(requestId: number, result: unknown): Promise<void> { return this.respondMock(requestId, result) }
  setMode(mode: string): Promise<void> { return this.setModeMock(mode) }
  setConfigOption(key: string, value: unknown): Promise<void> { return this.setConfigOptionMock(key, value) }
  extMethod(method: string, params: unknown): Promise<unknown> { return this.extMethodMock(method, params) }
  newSession(): Promise<void> { return this.newSessionMock() }
  loadSession(sessionId: string): Promise<void> { return this.loadSessionMock(sessionId) }
  listSessions(): Promise<SessionInfo[]> { return this.listSessionsMock() }
  deleteSession(sessionId: string): Promise<void> { return this.deleteSessionMock(sessionId) }
  setSessionModel(model: string): Promise<void> { return this.setSessionModelMock(model) }
  close(): Promise<void> { return this.closeMock() }
}
