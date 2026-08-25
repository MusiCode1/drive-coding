/**
 * local-session-view.ts — LocalSessionView מממש את SessionView port.
 *
 * עוטף AcpClient + WsAcpTransport (in-process).
 * - מריץ reduce מ-core על כל session/update
 * - מגשר onRequestPermission/onCreateElicitation ל-state.pending
 * - מעדכן state.quota מ-refreshQuota() (fetch)
 * - מגדיר turnState: prompt()→'waiting', cancel()/סיום-turn→'idle'
 * - חושף state (readonly) + patches (ReadableStream) + methods
 *
 * ─── 3 הדליפות שנסגרות כאן ───
 * 1. waitForOpen/closeAndWait/sendRaw — מוסתרים כאן (WsAcpTransport אינו נחשף לחוץ)
 * 2. createAcpClient vs createAttachedAcpClient — LocalSessionView מחליט internally
 * 3. TAKEOVER_CLOSE_CODE (4409) — מוגדר כ-constant כאן
 *
 * ─── slice session-view-port C2 (TDD) ───
 */

import type {
  CreateElicitationRequest,
  RequestPermissionRequest,
  SessionNotification,
} from "@agentclientprotocol/sdk"
import {
  createInitialSessionState,
  type Patch,
  reduce,
  type SessionState,
} from "@drive-coding/core/session"
import type { AcpClient, AcpClientCallbacks, PromptBlocks } from "@drive-coding/provider/client"
import { createExtClient } from "$lib/adapters/ext"
import { normalizeSessionInfo, type SessionInfo } from "$lib/adapters/sessions"
import type { ElicitationParams, ElicitationResponse } from "$lib/types/elicitation"
import type { PermissionParams, PermissionResponse } from "$lib/types/permission"
import type { SessionView, ViewEmission } from "./session-view"

// ─── Takeover close code (סוגר דליפה #3) ───
/** ⚠️ חייב להתאים ל-TAKEOVER_CODE ב-packages/backend/src/delivery/ws-agent.ts. */
const TAKEOVER_CLOSE_CODE = 4409

/**
 * LocalSessionView — מימוש של SessionView לסביבה in-process.
 * מקבל factory ליצירת AcpClient (injectable לבדיקות).
 * בפרודקשן (C4): ה-factory יוצר WsAcpTransport + AcpClient אמיתיים.
 */
export class LocalSessionView implements SessionView {
  // ─── Patches stream ───
  #controller: ReadableStreamDefaultController<ViewEmission> | null = null
  readonly patches: ReadableStream<ViewEmission>

  // ─── Session state (C1 fields) ───
  #state: SessionState = createInitialSessionState({ sessionId: null })

  // ─── Connection ───
  #client: AcpClient | null = null
  #sessionId: string | null = null

  // ─── Pending requests (permission + elicitation) ───
  #pendingPermissions: Map<number, (r: PermissionResponse) => void> = new Map()
  #pendingElicitations: Map<number, (r: ElicitationResponse) => void> = new Map()
  #nextRequestId = 0

  // ─── Client factory (injectable for tests; production: C4 will set default) ───
  readonly #createClientFn: (callbacks: AcpClientCallbacks) => Promise<AcpClient>

  // ─── Connection params (set at construction) ───
  readonly #cwd: string
  readonly #cliKind: string

  constructor(opts: {
    cwd: string
    cliKind: string
    /**
     * Client factory — invoked by newSession()/loadSession().
     *
     * Production (C4): creates WsAcpTransport + BE agent + AcpClient.
     * Tests: inject a mock factory that returns a fake AcpClient.
     *
     * Default: throws — use `createClient` option or upgrade to C4 wiring.
     */
    createClient?: (callbacks: AcpClientCallbacks) => Promise<AcpClient>
  }) {
    this.#cwd = opts.cwd
    this.#cliKind = opts.cliKind
    this.#createClientFn = opts.createClient ?? this.#defaultCreateClient.bind(this)

    this.patches = new ReadableStream<ViewEmission>({
      start: (controller) => {
        this.#controller = controller
      },
    })
  }

  // ─── State getter ───

  get state(): SessionState {
    return this.#state
  }

  // ─── slice local-view-wiring C2: adopt · dispose · observerCallbacks (TDD) ───

  /**
   * ה-callbacks שה-observer (ה-VM) צריך. **קריאה בלבד** — מחזירי-ערך
   * (onRequestPermission/onCreateElicitation) אינם כאן: שני עונים = תשובה כפולה.
   */
  get observerCallbacks(): Pick<AcpClientCallbacks, "onUpdate" | "onExtNotification"> {
    return {
      onUpdate: this.#onUpdate.bind(this),
      onExtNotification: this.#onExtNotification.bind(this),
    }
  }

  /**
   * מאמץ לקוח שה-VM יצר (ה-VM יוצר, ה-view מאמץ — brief §2.2). **מאפס** את ה-state —
   * כל קריאה היא סשן/חיבור חדש. ⚠️ אינו יורה getQuota (של ה-VM לעשות אם צריך), ואינו
   * סוגר/משחרר לקוח קודם — ה-VM מנהל את הלקוח; כאן רק מצביע + state.
   */
  adopt(input: { client: AcpClient; sessionId: string }): void {
    this.#client = input.client
    this.#sessionId = input.sessionId
    this.#state = createInitialSessionState({ sessionId: input.sessionId })
  }

  /**
   * משחרר את ה-view **בלי לגעת בלקוח**: סוגר את ה-controller (⇒ ה-drain מסיים ב-done)
   * ומנתק את המצביע. ⚠️ **dispose ≠ close** — close() קורא client.close()
   * (= transport.close()), ובמסלול המקומי הלקוח משותף עם ה-VM; close היה הורג את ה-WS.
   */
  dispose(): void {
    this.#client = null
    this.#sessionId = null
    try {
      this.#controller?.close()
    } catch {
      // כבר סגור/מבוטל
    }
  }

  // ─── Default client factory (production wiring — C4) ───

  async #defaultCreateClient(_callbacks: AcpClientCallbacks): Promise<AcpClient> {
    throw new Error(
      "LocalSessionView: default production client factory not yet implemented. " +
        "Pass `createClient` option or use C4 wiring.",
    )
  }

  // ─── Callbacks (passed to AcpClient) ───

  #makeCallbacks(): AcpClientCallbacks {
    return {
      onUpdate: this.#onUpdate.bind(this),
      onRequestPermission: this.#onRequestPermission.bind(this),
      onCreateElicitation: this.#onCreateElicitation.bind(this),
      onExtNotification: this.#onExtNotification.bind(this),
    }
  }

  /**
   * מקבל session/update notification, מריץ reduce, ומעדכן state + stream.
   * (סוגר דליפה #1: transport internals אינם נחשפים)
   */
  #onUpdate(notification: SessionNotification): void {
    const { state, patches } = reduce(this.#state, notification.update)
    this.#state = state
    if (patches.length > 0) {
      try {
        this.#controller?.enqueue({ patches, updates: [] })
      } catch {
        // Stream cancelled or closed — ignore
      }
    }
  }

  /**
   * מגשר onRequestPermission ל-state.pending.permission.
   * מחזיר Promise שנפתר כש-respond(requestId, result) נקרא.
   */
  #onRequestPermission(params: PermissionParams): Promise<PermissionResponse> {
    const requestId = this.#nextRequestId++
    return new Promise<PermissionResponse>((resolve) => {
      // Pending יחיד — בקשה שנייה מבטלת את הקודמת (כמו VM הקיים)
      this.#cancelAllPendingPermissions()
      this.#pendingPermissions.set(requestId, resolve)
      this.#state = {
        ...this.#state,
        pending: {
          ...this.#state.pending,
          permission: {
            requestId,
            params: params as unknown as RequestPermissionRequest,
          },
        },
      }
    })
  }

  /**
   * מגשר onCreateElicitation ל-state.pending.elicitation.
   * מחזיר Promise שנפתר כש-respond(requestId, result) נקרא.
   */
  #onCreateElicitation(params: ElicitationParams): Promise<ElicitationResponse> {
    const requestId = this.#nextRequestId++
    return new Promise<ElicitationResponse>((resolve) => {
      this.#cancelAllPendingElicitations()
      this.#pendingElicitations.set(requestId, resolve)
      this.#state = {
        ...this.#state,
        pending: {
          ...this.#state.pending,
          elicitation: {
            requestId,
            params: params as unknown as CreateElicitationRequest,
          },
        },
      }
    })
  }

  /**
   * מקבל ext notifications (_drive/capabilities וכו').
   * TODO C4: handle _drive/capabilities → update state.capabilities
   */
  #onExtNotification(_method: string, _params: Record<string, unknown>): void {
    // placeholder — C4 יממש
  }

  // ─── Cancel helpers ───

  #cancelAllPendingPermissions(): void {
    for (const [, resolve] of this.#pendingPermissions) {
      resolve({ outcome: { outcome: "cancelled" } })
    }
    this.#pendingPermissions.clear()
    this.#state = { ...this.#state, pending: { ...this.#state.pending, permission: null } }
  }

  #cancelAllPendingElicitations(): void {
    for (const [, resolve] of this.#pendingElicitations) {
      resolve({ action: "cancel" })
    }
    this.#pendingElicitations.clear()
    this.#state = { ...this.#state, pending: { ...this.#state.pending, elicitation: null } }
  }

  // ─── Public methods (SessionView interface) ───

  /**
   * מגיב לבקשת הרשאה/elicitation ממתינה.
   * `requestId` מגיע מ-state.pending.permission/elicitation.requestId.
   */
  async respond(requestId: number, result: unknown): Promise<void> {
    const permResolve = this.#pendingPermissions.get(requestId)
    if (permResolve) {
      this.#pendingPermissions.delete(requestId)
      permResolve(result as PermissionResponse)
      this.#state = { ...this.#state, pending: { ...this.#state.pending, permission: null } }
      return
    }
    const elicResolve = this.#pendingElicitations.get(requestId)
    if (elicResolve) {
      this.#pendingElicitations.delete(requestId)
      elicResolve(result as ElicitationResponse)
      this.#state = { ...this.#state, pending: { ...this.#state.pending, elicitation: null } }
      return
    }
    // Unknown requestId — no-op
  }

  /**
   * יוצר session ACP חדש.
   * קורא ל-createClientFn → client.newSession() → מעדכן state.
   */
  async newSession(): Promise<void> {
    this.#state = { ...this.#state, status: "connecting" }
    this.#client = await this.#createClientFn(this.#makeCallbacks())
    const result = await this.#client.newSession({ cwd: this.#cwd })
    const sessionId = (result as { sessionId?: string }).sessionId ?? null
    this.#sessionId = sessionId
    this.#state = { ...this.#state, status: "connected", sessionId }
    await this.#refreshQuota()
  }

  /**
   * טוען session ACP קיים לפי sessionId.
   * cwd אופציונלי (slice remote-session-mgmt C5): כשנמסר — מחליף את cwd החיבור;
   * אחרת cwd החיבור המקורי (#cwd).
   */
  async loadSession(sessionId: string, cwd?: string): Promise<void> {
    this.#state = { ...this.#state, status: "connecting" }
    this.#client = await this.#createClientFn(this.#makeCallbacks())
    await this.#client.loadSession({ sessionId, cwd: cwd ?? this.#cwd })
    this.#sessionId = sessionId
    this.#state = { ...this.#state, status: "connected", sessionId }
    await this.#refreshQuota()
  }

  /**
   * שולח פרומפט.
   * מגדיר turnState='waiting' לפני, 'idle' אחרי RESP.
   * _meta שמור ל-S3 (meta passthrough — synthesizeUserMessage).
   */
  async prompt(content: string | PromptBlocks, _meta?: Record<string, unknown>): Promise<void> {
    if (!this.#client || !this.#sessionId) throw new Error("LocalSessionView: not connected")
    this.#state = { ...this.#state, turnState: "waiting" }
    try {
      await this.#client.prompt(this.#sessionId, content)
      this.#state = { ...this.#state, turnState: "idle" }
    } catch (e) {
      this.#state = { ...this.#state, turnState: "idle" }
      throw e
    }
  }

  /** מבטל תור פעיל. מגדיר turnState='idle'. */
  async cancel(): Promise<void> {
    if (this.#client && this.#sessionId) {
      try {
        await this.#client.cancel(this.#sessionId)
      } catch {
        // ignore cancel errors
      }
    }
    this.#state = { ...this.#state, turnState: "idle" }
  }

  async setMode(mode: string): Promise<void> {
    if (!this.#client || !this.#sessionId) throw new Error("LocalSessionView: not connected")
    await this.#client.setSessionMode({ sessionId: this.#sessionId, modeId: mode })
  }

  async setConfigOption(key: string, value: unknown): Promise<void> {
    if (!this.#client || !this.#sessionId) throw new Error("LocalSessionView: not connected")
    await this.#client.setSessionConfigOption({
      sessionId: this.#sessionId,
      configId: key,
      value: value as string | boolean,
    })
  }

  async extMethod(method: string, params: unknown): Promise<unknown> {
    if (!this.#client) throw new Error("LocalSessionView: not connected")
    return this.#client.extMethod(method, params as Record<string, unknown>)
  }

  async listSessions(): Promise<SessionInfo[]> {
    if (!this.#client) throw new Error("LocalSessionView: not connected")
    const result = await this.#client.listSessions()
    const sessions = (result as { sessions?: unknown[] }).sessions ?? []
    return sessions.map(normalizeSessionInfo)
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (!this.#client) throw new Error("LocalSessionView: not connected")
    await this.#client.deleteSession(sessionId)
  }

  /**
   * slice remote-session-mgmt C5: האם הסוכן מכריז sessionCapabilities.delete —
   * raw ACP caps מה-initialize (אותו ביטוי בדיוק כמו ה-VM, agent-session.svelte.ts).
   * false עד שיש client חי בלי יכולת delete מוצהרת.
   */
  get supportsSessionDelete(): boolean {
    return this.#client?.capabilities?.sessionCapabilities?.delete != null
  }

  async setSessionModel(model: string): Promise<void> {
    if (!this.#client || !this.#sessionId) throw new Error("LocalSessionView: not connected")
    await this.#client.setSessionModel({ sessionId: this.#sessionId, modelId: model })
  }

  /**
   * סוגר את החיבור.
   * מבטל pending permission/elicitation כ-cancelled לפני הסגירה.
   */
  async close(): Promise<void> {
    this.#cancelAllPendingPermissions()
    this.#cancelAllPendingElicitations()
    this.#client?.close()
    this.#client = null
    this.#sessionId = null
    this.#state = { ...this.#state, status: "disconnected" }
    try {
      this.#controller?.close()
    } catch {
      // already closed or cancelled
    }
  }

  // ─── Private: quota refresh ───

  /**
   * מרענן state.quota מ-_drive/getQuota (fetch, לא wire).
   * שגיאות non-fatal — quota מוצג אם זמין.
   */
  async #refreshQuota(): Promise<void> {
    if (!this.#client || !this.#sessionId) return
    try {
      const ext = createExtClient(this.#client)
      const quota = await ext.getQuota(this.#sessionId)
      this.#state = { ...this.#state, quota }
    } catch {
      // quota failures are non-fatal — keep previous quota
    }
  }
}

// ─── Re-export for convenience ───
export type { SessionView } from "./session-view"
