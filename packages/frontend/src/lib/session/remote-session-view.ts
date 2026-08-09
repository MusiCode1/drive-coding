/**
 * remote-session-view.ts — RemoteSessionView מממש את SessionView port.
 *
 * מתחבר ל-SessionHost בשרת דרך HTTP+SSE (S4 routes):
 * - GET  /api/agents/:id/events  — SSE snapshot+patches (דרך SSEReader)
 * - POST /api/agents/:id/rpc     — prompt/cancel/setMode/setConfigOption/setSessionModel/extMethod
 * - POST /api/agents/:id/reply   — respond ל-permission/elicitation
 *
 * Session management (newSession/loadSession/listSessions/deleteSession) זורקות —
 * ה-backend מנהל sessions (§5.1 lifecycle), ה-FE לא.
 *
 * Reactivity: RemoteSessionView רק מתחזק state + מזרים patches (עוטף כל Patch בודד
 * מ-SSEReader ל-[patch] כדי להתאים ל-VM's ReadableStream<Patch[]>). ה-VM עושה את
 * ההחלה הממוקדת על Bubble[] (consumeViewPatches/applyPatchMutable, S1/S2) — לא כאן.
 * state עצמו מתעדכן דרך applyPatch (core, טהור/immutable) — לא כותבים applyPatch חדש.
 *
 * ─── slice remote-session-view C2 (TDD) ───
 */

import {
  applyPatch,
  createInitialSessionState,
  type Patch,
  type SessionState,
} from "@drive-coding/core/session"
import type { PromptBlocks } from "@drive-coding/provider/client"
import type { SessionInfo } from "$lib/adapters/sessions"
import type { SessionView } from "./session-view.js"
import { SSEReader } from "./sse-reader.js"

/** ext methods שדורשות return value אמיתי — לא נתמכות ב-remote mode (§C2 decision #3). */
const RETURN_VALUE_EXT_METHODS = new Set<string>(["_drive/getQuota"])

const NOT_SUPPORTED_SESSION_MGMT = "not supported in remote mode — backend manages sessions"
const NOT_SUPPORTED_EXT_RETURN_VALUE = "not supported in remote mode — use state instead"

export type RemoteSessionViewOptions = {
  /** HTTP headers לכל בקשה (auth וכו'). */
  headers?: Record<string, string>
  /** @internal לבדיקות — override global fetch. */
  _fetch?: (url: string, init?: RequestInit) => Promise<Response>
  /** @internal לבדיקות — override setTimeout-based sleep (מועבר ל-SSEReader). */
  _sleep?: (ms: number) => Promise<void>
}

/**
 * RemoteSessionView — מימוש SessionView שמתחבר ל-SessionHost בשרת (HTTP+SSE).
 *
 * Usage:
 *   const view = new RemoteSessionView("agent-1", "https://be.example.com")
 *   await view.connect()
 *   // view.state / view.patches מתעדכנים; view.prompt(...) וכו' שולחות RPC
 *   await view.close()  // כשמסיימים
 */
export class RemoteSessionView implements SessionView {
  readonly #agentId: string
  readonly #baseUrl: string
  readonly #headers: Record<string, string>
  readonly #doFetch: (url: string, init?: RequestInit) => Promise<Response>
  readonly #reader: SSEReader

  #state: SessionState
  #sessionId: string | null = null

  // ─── patches stream (עטוף — Patch בודד מ-SSEReader → [patch]) ───
  #patchesCtrl: ReadableStreamDefaultController<Patch[]> | null = null
  readonly patches: ReadableStream<Patch[]>

  constructor(agentId: string, baseUrl: string, opts: RemoteSessionViewOptions = {}) {
    this.#agentId = agentId
    this.#baseUrl = baseUrl
    this.#headers = opts.headers ?? {}
    this.#doFetch = opts._fetch ?? ((u, init) => globalThis.fetch(u, init))
    // replaced on connect() by the SSE snapshot — this is just a safe pre-connect default
    this.#state = createInitialSessionState({ sessionId: null })

    this.#reader = new SSEReader(this.#eventsUrl(), {
      headers: this.#headers,
      _fetch: opts._fetch,
      _sleep: opts._sleep,
    })

    this.patches = new ReadableStream<Patch[]>({
      start: (ctrl) => {
        this.#patchesCtrl = ctrl
      },
    })
  }

  // ─── SessionView: state ───

  get state(): SessionState {
    return this.#state
  }

  // ─── Lifecycle ───

  /** מתחבר ל-SSE, מאחזר snapshot (כולל sessionId), ומתחיל להאזין ל-patches. */
  async connect(): Promise<void> {
    const { snapshot, patches } = await this.#reader.connect()
    this.#state = snapshot
    this.#sessionId = snapshot.sessionId
    void this.#drainPatches(patches)
  }

  /** סוגר את חיבור ה-SSE ומפנה משאבים. */
  async close(): Promise<void> {
    this.#reader.close()
    try {
      this.#patchesCtrl?.close()
    } catch {
      // already closed
    }
  }

  // ─── Incoming patches: apply to state (core applyPatch) + wrap + emit ───

  async #drainPatches(patches: ReadableStream<Patch>): Promise<void> {
    const reader = patches.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        this.#applyIncoming(value)
      }
    } finally {
      reader.releaseLock()
    }
  }

  #applyIncoming(patch: Patch): void {
    this.#state = applyPatch(this.#state, patch)
    this.#emit([patch])
  }

  #emit(patches: Patch[]): void {
    try {
      this.#patchesCtrl?.enqueue(patches)
    } catch {
      // stream cancelled by consumer — ignore
    }
  }

  // ─── Session management — backend manages sessions ───

  newSession(): Promise<void> {
    return Promise.reject(new Error(NOT_SUPPORTED_SESSION_MGMT))
  }

  loadSession(_sessionId: string): Promise<void> {
    return Promise.reject(new Error(NOT_SUPPORTED_SESSION_MGMT))
  }

  listSessions(): Promise<SessionInfo[]> {
    return Promise.reject(new Error(NOT_SUPPORTED_SESSION_MGMT))
  }

  deleteSession(_sessionId: string): Promise<void> {
    return Promise.reject(new Error(NOT_SUPPORTED_SESSION_MGMT))
  }

  // ─── RPC methods ───

  async prompt(content: string | PromptBlocks, meta?: Record<string, unknown>): Promise<void> {
    await this.#rpc("prompt", { sessionId: this.#sessionId, content, meta })
  }

  async cancel(): Promise<void> {
    await this.#rpc("cancel", { sessionId: this.#sessionId })
  }

  async setMode(mode: string): Promise<void> {
    await this.#rpc("setMode", { sessionId: this.#sessionId, modeId: mode })
  }

  async setConfigOption(key: string, value: unknown): Promise<void> {
    await this.#rpc("setConfigOption", { sessionId: this.#sessionId, configId: key, value })
  }

  async setSessionModel(model: string): Promise<void> {
    await this.#rpc("setSessionModel", { sessionId: this.#sessionId, model })
  }

  async extMethod(method: string, params: unknown): Promise<unknown> {
    if (RETURN_VALUE_EXT_METHODS.has(method)) {
      throw new Error(NOT_SUPPORTED_EXT_RETURN_VALUE)
    }
    return this.#rpc("extMethod", { sessionId: this.#sessionId, method, params })
  }

  // ─── Reply (permission/elicitation) ───

  /**
   * גוזר kind מ-state.pending: permission נבדק ראשון (עדיפות ב-edge case נדיר
   * שבו שניהם pending עם אותו requestId — תואם ל-reply.ts:30 warning).
   */
  async respond(requestId: number, result: unknown): Promise<void> {
    const kind =
      this.#state.pending.permission?.requestId === requestId
        ? "permission"
        : this.#state.pending.elicitation?.requestId === requestId
          ? "elicitation"
          : "permission"
    await this.#post(this.#replyUrl(), { kind, requestId, result })
  }

  // ─── Private: HTTP helpers ───

  #eventsUrl(): string {
    return `${this.#baseUrl}/api/agents/${this.#agentId}/events`
  }

  #rpcUrl(): string {
    return `${this.#baseUrl}/api/agents/${this.#agentId}/rpc`
  }

  #replyUrl(): string {
    return `${this.#baseUrl}/api/agents/${this.#agentId}/reply`
  }

  async #rpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    const res = await this.#post(this.#rpcUrl(), { method, params })
    return res
  }

  async #post(url: string, body: unknown): Promise<unknown> {
    const res = await this.#doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.#headers },
      body: JSON.stringify(body),
    })
    if (!res.json) return undefined
    try {
      return await res.json()
    } catch {
      return undefined
    }
  }
}

// ─── Re-export for convenience ───
export type { SessionView } from "./session-view.js"
