/**
 * mock-session-view.svelte.ts — MockSessionView test helper.
 *
 * מימוש מינימלי של SessionView לטסטים של AgentSession (C3).
 * חושף `fireUpdate(update)` לסימולציה של session/update events.
 *
 * ─── slice session-view-port C3 (test helper) ───
 * ─── slice view-switch C3 (additive): applyAndEmit — patches ש-reduce לא מכיר ───
 * (pending/turnState/lastTurnError) מגיעים ב-remote דרך update-session patches, לא
 * דרך session/update wire events. reduce() לא בונה אותם — applyAndEmit מריץ applyPatch
 * (core, טהור) על patch שהטסט בונה בעצמו (בד"כ עם applyPendingRequest/clearPendingRequest/
 * applyTurnEnd מ-core, כמו ה-remote harness ב-C1) ודוחף אותו ל-stream.
 */
import {
  applyPatch,
  createInitialSessionState,
  type Patch,
  reduce,
  type SessionState,
} from "@drive-coding/core/session"
import type { PromptBlocks } from "@drive-coding/provider/client"
import { vi } from "vitest"
import type { SessionInfo } from "$lib/adapters/sessions"
import type { SessionView, ViewEmission } from "$lib/session/session-view"

export class MockSessionView implements SessionView {
  // ─── state (plain object, updated by fireUpdate) ───
  state: SessionState = $state(createInitialSessionState({ sessionId: null }))

  // ─── slice remote-session-mgmt C5: port extension — supportsSessionDelete ───
  // Mutable so tests can toggle the capability; the VM getter must follow it.
  supportsSessionDelete = $state(false)

  // ─── patches stream ───
  #controller: ReadableStreamDefaultController<ViewEmission> | null = null
  readonly patches: ReadableStream<ViewEmission>

  // Track calls for assertions
  readonly promptMock = vi
    .fn<(content: string | PromptBlocks, meta?: Record<string, unknown>) => Promise<void>>()
    .mockResolvedValue(undefined)
  readonly cancelMock = vi.fn().mockResolvedValue(undefined)
  readonly newSessionMock = vi.fn().mockResolvedValue(undefined)
  readonly loadSessionMock = vi.fn().mockResolvedValue(undefined)
  readonly closeMock = vi.fn().mockResolvedValue(undefined)
  readonly respondMock = vi.fn().mockResolvedValue(undefined)
  readonly setModeMock = vi.fn().mockResolvedValue(undefined)
  readonly setConfigOptionMock = vi.fn().mockResolvedValue(undefined)
  readonly extMethodMock = vi.fn().mockResolvedValue(undefined)
  readonly listSessionsMock = vi.fn<() => Promise<SessionInfo[]>>().mockResolvedValue([])
  readonly deleteSessionMock = vi.fn().mockResolvedValue(undefined)
  readonly setSessionModelMock = vi.fn().mockResolvedValue(undefined)

  constructor() {
    this.patches = new ReadableStream<ViewEmission>({
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
    try {
      this.#controller?.enqueue({ patches, updates: [update] })
    } catch {
      // stream closed
    }
  }

  /**
   * מחיל patch (applyPatch, core) על ה-state ודוחף אותו ל-stream — לסימולציית
   * update-session patches (pending/turnState/lastTurnError) שאין ל-reduce מושג
   * עליהם (ר' slice view-switch C1: אותה טכניקה בדיוק כמו ה-remote contract harness).
   */
  applyAndEmit(patch: Patch): void {
    const next = applyPatch(this.state, patch)
    if (next) this.state = next
    try {
      this.#controller?.enqueue({ patches: [patch], updates: [] })
    } catch {
      // stream closed
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
  cancel(): Promise<void> {
    return this.cancelMock()
  }
  respond(requestId: number, result: unknown): Promise<void> {
    return this.respondMock(requestId, result)
  }
  setMode(mode: string): Promise<void> {
    return this.setModeMock(mode)
  }
  setConfigOption(key: string, value: unknown): Promise<void> {
    return this.setConfigOptionMock(key, value)
  }
  extMethod(method: string, params: unknown): Promise<unknown> {
    return this.extMethodMock(method, params)
  }
  newSession(): Promise<void> {
    return this.newSessionMock()
  }
  loadSession(sessionId: string, cwd?: string): Promise<void> {
    return this.loadSessionMock(sessionId, cwd)
  }
  listSessions(): Promise<SessionInfo[]> {
    return this.listSessionsMock()
  }
  deleteSession(sessionId: string): Promise<void> {
    return this.deleteSessionMock(sessionId)
  }
  setSessionModel(model: string): Promise<void> {
    return this.setSessionModelMock(model)
  }
  close(): Promise<void> {
    return this.closeMock()
  }
}
