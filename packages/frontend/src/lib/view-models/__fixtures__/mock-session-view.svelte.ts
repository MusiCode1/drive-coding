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
  type SessionState,
} from "@drive-coding/core/session"
import type { PromptBlocks } from "@drive-coding/provider/client"
import { vi } from "vitest"
import type { SessionInfo } from "$lib/adapters/sessions"
import type { SessionView } from "$lib/session/session-view"
import { type ProjectionSink, SessionViewDelivery } from "$lib/session/session-view-delivery"
import { projectSessionSnapshot } from "$lib/session/session-view-projection"

export class MockSessionView implements SessionView {
  #delivery = new SessionViewDelivery()
  get state(): SessionState {
    return this.#delivery.state
  }
  set state(state: SessionState) {
    this.#delivery.state = state
  }
  bindProjection(sink: ProjectionSink): void {
    this.#delivery.bind(sink)
  }
  beginProjection(id: string | null, preserveControl = false): void {
    this.#delivery.begin(id, preserveControl)
  }
  supportsSessionDelete = $state(false)

  // Track calls for assertions
  readonly promptMock = vi
    .fn<(content: string | PromptBlocks, meta?: Record<string, unknown>) => Promise<void>>()
    .mockResolvedValue(undefined)
  readonly cancelMock = vi.fn().mockResolvedValue(undefined)
  readonly newSessionMock = vi
    .fn<(cwd?: string) => Promise<void>>()
    .mockImplementation(async () => {
      this.state = { ...this.state, sessionId: "remote-new-sess" }
    })
  readonly loadSessionMock = vi.fn().mockResolvedValue(undefined)
  readonly closeMock = vi.fn().mockResolvedValue(undefined)
  readonly respondMock = vi.fn().mockResolvedValue(undefined)
  readonly setModeMock = vi.fn().mockResolvedValue(undefined)
  readonly setConfigOptionMock = vi.fn().mockResolvedValue(undefined)
  readonly extMethodMock = vi.fn().mockResolvedValue(undefined)
  readonly listSessionsMock = vi.fn<() => Promise<SessionInfo[]>>().mockResolvedValue([])
  readonly deleteSessionMock = vi.fn().mockResolvedValue(undefined)
  readonly setSessionModelMock = vi.fn().mockResolvedValue(undefined)

  hydrate(): void {
    this.#delivery.frame(projectSessionSnapshot(this.state, this.state.messages.length > 0), true)
    this.#delivery.endBatch(this.state)
  }
  applySnapshot(state: SessionState, resetOrigin?: "same-session-reconnect"): void {
    this.#delivery.frame(projectSessionSnapshot(state, true, resetOrigin), true)
    this.#delivery.endBatch(state)
  }
  fireUpdate(update: unknown): void {
    this.#delivery.update(update, true)
    this.#delivery.endBatch(this.state)
  }
  applyAndEmit(patch: Patch): void {
    const next = applyPatch(this.state, patch)
    if (!next) return
    if (patch.op === "reset") this.#delivery.frame(projectSessionSnapshot(next, true), true)
    else {
      this.#delivery.state = next
      this.#delivery.endBatch(next)
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
  newSession(cwd?: string): Promise<void> {
    return this.newSessionMock(cwd)
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
    this.#delivery.dispose()
    return this.closeMock()
  }
}
