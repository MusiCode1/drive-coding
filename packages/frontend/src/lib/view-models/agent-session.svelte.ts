/**
 * AgentSession — view-model מינימלי עבור סשן ACP יחיד.
 *
 * מנהל (Owns):
 *   - מצב חיבור (status, error)
 *   - הצטברות בועות (bubble accumulation) מהתראות session/update
 *   - פעולות חיבור וסשן דרך SessionView
 */

import type {
  AvailableCommand,
  SessionConfigOption,
  SessionModeState,
  SessionNotification,
  UsageUpdate,
} from "@agentclientprotocol/sdk"
import { createAgent, deleteAgent, releaseConnection } from "$lib/adapters/agents-api"
import type { SessionInfo } from "$lib/adapters/sessions"
import type { CuesEngine } from "$lib/engines/cues"
// ─── slice leave-running-background ───
import {
  evaluateTurn,
  initialTurnActivity,
  onActivity,
  onTurnEnded,
  onTurnStarted,
  type TurnActivityState,
} from "$lib/engines/turn-watchdog"
// ─── slice view-switch C3: createRemoteView (attachRemote) ─── (additive)
import { createRemoteView } from "$lib/session/create-session-view"
import { findListedSession } from "$lib/session/find-listed-session"
import type { SessionTransport } from "$lib/session/session-transport"
import type { SessionView } from "$lib/session/session-view"
import type { Bubble, ToolCall } from "$lib/types/bubble"
// ─── slice-elicitation-ui: טיפוסי שאלה מובנת (view-model layer, נגזרים מ-SDK) ───
import type { ElicitationParams, ElicitationResponse } from "$lib/types/elicitation"
// ─── slice-permission-ui-basic: טיפוסי בקשת-הרשאה (view-model layer, נגזרים מ-SDK) ───
import type { PermissionParams, PermissionResponse } from "$lib/types/permission"
import type { GuidanceAuthMethod } from "$lib/util/auth-guidance"
import { connWarn } from "$lib/util/conn-log"
import { isBypassMode } from "$lib/util/permission-mode"
import { safeUUID } from "$lib/util/uuid"
import {
  type ApplyConfigOptionDeps,
  applyConfigOption as applyConfigOptionExtracted,
  setThinkingTokens,
} from "$lib/view-models/agent-session-apply-config"
import { sessionAttachFailure } from "$lib/view-models/agent-session-attach-failure"
import {
  type CaptureSessionConfigDeps,
  captureSessionConfig,
} from "$lib/view-models/agent-session-capture-config"
import { isValidChoice } from "$lib/view-models/agent-session-config-choice"
import {
  type DeleteSessionDeps,
  deleteSession as deleteSessionExtracted,
} from "$lib/view-models/agent-session-delete"
import { type LoadMockSessionDeps, loadMockSession } from "$lib/view-models/agent-session-load-mock"
import {
  applyManualTitleFromAttach,
  applyTitleFromSessionInfo,
  applyTitleFromSessionInput,
  type ManualTitleInput,
  setManualTitleOnAgent,
} from "$lib/view-models/agent-session-manual-title"
import {
  endSessionScope,
  registerSessionEndListener,
  type SessionEndReason,
  type SessionEndScopeDeps,
} from "$lib/view-models/agent-session-session-end"
import {
  type ListedSessionInput,
  newListedSession,
  switchListedSession,
} from "$lib/view-models/agent-session-switch-listed-session"
import { type LegacyPromptOptions, sendLegacyPrompt } from "./agent-session-prompt-send"
import { syncViewMetadata, syncViewTurnError } from "./agent-session-view-sync"
import { formatAcpError } from "$lib/view-models/format-acp-error"
import { SessionScope } from "$lib/view-models/session-scoped-state.svelte"
import { SessionsCacheScope } from "$lib/view-models/sessions-cache-scope.svelte"
import type { Settings } from "$lib/view-models/settings.svelte"
import {
  extractParentToolUseId,
  handleSubagentToolCall,
  handleSubagentToolCallUpdate,
  type SubagentToolNestingDeps,
} from "$lib/view-models/subagent-tool-nesting"

export type { SessionEndReason } from "$lib/view-models/agent-session-session-end"

// ─── slice plan-todo-list Commit 1: reducer טהור + טיפוסים ─── (additive)
import { type PlanStore, reducePlan } from "@drive-coding/core/acp/plan"
// ─── slice session-state-reducer C4: reduce + types ─── (additive)
import {
  createInitialSessionState,
  reduce,
  type SessionListQuery,
  type SessionState,
} from "@drive-coding/core/session"
// ─── slice session-budget-meter Commit 4: QuotaSnapshot טיפוס בלבד ─── (additive)
import type { QuotaSnapshot } from "@drive-coding/provider/extensions"
// ─── slice FE-normalization: ייבוא ─── (additive)
// import type בלבד — NormalizedCapabilities מ-subpath ./types (pure, ללא spawn-core).
// ⚠️ אל תייבא value מ-@drive-coding/provider/host → יגרור spawn-core → vite crash.
import type { NormalizedCapabilities } from "@drive-coding/provider/types"
// ─── slice session-state-reducer C4: FE patch applicator + mappers ─── (additive)
import { applyPatchMutable } from "$lib/session/apply-patch-mutable"
import { mapLocations, mapToolContent } from "$lib/session/map-tool-content"
import type { ViewEmission } from "$lib/session/session-view"
import { consumeViewPatches, historyIngestDepsFrom } from "./agent-session-history-ingest.js"
import type { HistoryMark } from "./history-mark.js"
import { bindHistory, HistoryState } from "./history-state.svelte.js"
// ─── slice subagent-identity-gate: ניתוב תעתיק (חילוץ מ-VM) ───
import { type SubagentTranscriptDeps, SubagentTranscriptRouter } from "./subagent-transcript-router"

type SessionModelState = {
  currentModelId: string
  availableModels: Array<{ modelId: string; name: string; description?: string | null }>
}

export type AgentSessionStatus =
  | "idle" // טרם נוצר סוכן
  | "connecting" // יוצר סוכן + לחיצת יד של ACP
  | "connected" // מוכן לקבל פרומפטים
  | "error"
  | "disconnected" // WS נפל, ממתין ל-reconnect (ידני/אוטו) — slice ws-reconnect-infra

/** מה המודל עושה בתור הנוכחי. מופרד מ-status (חיבור) — §1 ב-brief. */
export type TurnState = "idle" | "waiting" | "thinking" | "responding" | "calling-tool"

/**
 * ─── עיצוב תוספתי בטוח למקביליות ───
 *
 * הוספת מתודה חדשה ל-AgentSession:
 *   - שינויי State (שדות `$state`) → פולשני (INVASIVE). עצור ושאל את Tama.
 *   - מתודה ציבורית חדשה (`loadSession` וכו') → תוספתי (ADDITIVE). מקם בבלוק
 *     ה-`// ─── domain ───` המתאים, או הוסף בלוק חדש לפני
 *     `// ─── private ───`.
 *   - פונקציית עזר פרטית חדשה → תוספתי (ADDITIVE). מקם ב-`// ─── private ───`.
 */
export class AgentSession {
  // ─── slice 6: cues injection ─── (אופציונלי — slice 9 יקשר ל-Settings)
  readonly #cues?: CuesEngine
  // ─── slice-restore-last-config: settings injection (אופציונלי — no-op אם נעדר) ───
  readonly #settings?: Settings
  // ─── slice session-view-port C3: SessionView DI (אופציונלי — C4 יעביר אל זה בכל attach/loadSession) ───
  #view: SessionView | null = null
  #sessionTransport: SessionTransport = "ws"

  get sessionTransport(): SessionTransport {
    return this.#sessionTransport
  }

  /** @internal For testing — called on every notification entering #onSessionUpdate. */
  #onUpdateObserved?: (update: unknown) => void

  constructor(opts?: {
    view?: SessionView
    cues?: CuesEngine
    settings?: Settings
    /** @internal For testing — invoked on **every** notification entering #onSessionUpdate. */
    _onUpdateObserved?: (update: unknown) => void
  }) {
    this.#cues = opts?.cues
    this.#settings = opts?.settings
    this.#onUpdateObserved = opts?._onUpdateObserved
    // ─── slice session-view-port C3: אם view הוזרק ─── (additive)
    if (opts?.view) {
      this.#view = opts.view
      void this.#consumeViewPatches(opts.view)
    }
    if (typeof document !== "undefined") {
      // watchdog §2 — רק בדפדפן. בטסטים/SSR אין טיימר רקע שידלוף.
      this.#startStallWatch()
    }
    this.#subagentTranscript = new SubagentTranscriptRouter(this.#subagentTranscriptDeps())
  }

  #subagentTranscriptDeps(): SubagentTranscriptDeps {
    return {
      bubbles: () => this.bubbles,
      sessionState: () => this.sessionState,
    }
  }

  // ─── state ─── (פולשני לעריכה — תאם מול Tama)
  status = $state<AgentSessionStatus>("idle")
  /** מה המודל עושה בתור הנוכחי. idle = אין תור פעיל. */
  turnState = $state<TurnState>("idle")
  error = $state<string | null>(null)
  authMethods = $state<ReadonlyArray<GuidanceAuthMethod>>([])
  bubbles = $state<Bubble[]>([])
  // ─── slice session-state-reducer C4: מצב SessionState פנימי (base ל-reduce) ─── (additive)
  sessionState = $state<SessionState>(createInitialSessionState({ sessionId: null }))
  agentId = $state<string | null>(null)
  agentNotes = $state("")
  agentFields = $state<Record<string, string>>({})
  cwd = $state<string | null>(null)
  // ─── slice 4: replay guard + narration context ─── (תוספתי)
  /** True בזמן ש-loadSession() מנגן היסטוריה מחדש. ה-Speaker קורא את זה (תחת מעקב) כדי להשתיק TTS. */
  isLoadingHistory = $state(false)
  /** מונה חתכי-היסטוריה. עולה **פעם אחת** ב-hydration של view חדש. */
  historyEpoch = $state(0)
  /** החתך שנלקח באותו רגע. לא-ריאקטיבי בכוונה — נקרא רק כש-historyEpoch משתנה. */
  #historyMark: HistoryMark = { segmentCounts: new Map(), toolCallIds: [] }
  get historyMark(): HistoryMark {
    return this.#historyMark
  }
  readonly #historyState = new HistoryState()
  get history(): HistoryState {
    return this.#historyState
  }
  /** טקסט הפרומפט האחרון שנשלח על ידי המשתמש — משמש את ה-Speaker להקשר עבור קריינות. */
  lastUserMessage = $state("")

  // ─── slice-permission-ui-basic: בקשת הרשאה חיה (agent→client, ממתינה לתשובה) ───
  /**
   * בקשת הרשאה ממתינה מהסוכן — pending יחיד (בקשה שנייה סוגרת את הקודמת כ-cancelled).
   * null = אין בקשה פעילה. ה-UI (PermissionRequestBlock) מרנדר inline כשזה לא-null.
   * The request ID identifies the pending permission in the SessionView.
   */
  pendingPermission = $state<{
    requestId?: number
    params: PermissionParams
    resolve: (r: PermissionResponse) => void
  } | null>(null)

  // ─── slice-elicitation-ui: שאלה מובנת חיה (agent→client, ממתינה לתשובה) ───
  /**
   * שאלה מובנת ממתינה מהסוכן — pending יחיד (בקשה שנייה סוגרת את הקודמת כ-cancelled).
   * null = אין בקשה פעילה. ה-UI (ElicitationDialog) מרנדר inline כשזה לא-null.
   * The request ID identifies the pending elicitation in the SessionView.
   */
  pendingElicitation = $state<{
    requestId?: number
    params: ElicitationParams
    resolve: (r: ElicitationResponse) => void
  } | null>(null)

  // ─── slice 23: session config ─── (תוספתי)
  /** אפשרויות config של הסשן הפתוח — מאוכלס מתגובת newSession/loadSession. */
  configOptions = $state<SessionConfigOption[]>([])
  /** מצב המודלים הזמינים — null אם ה-agent לא חשף מידע מודל. */
  models = $state<SessionModelState | null>(null)
  /** מצב ה-modes הזמינים — null אם ה-agent לא חשף מידע mode. */
  modes = $state<SessionModeState | null>(null)

  // ─── slice session-scope-migration: per-session holder ($state required — §3.5) ───
  #session = $state(new SessionScope(null))

  get sessionTitle(): string {
    return this.#session.title
  }
  set sessionTitle(v: string) {
    this.#session.title = v
  }
  get titleManual(): boolean {
    return this.#session.titleManual
  }
  set titleManual(v: boolean) {
    this.#session.titleManual = v
  }
  get availableCommands(): AvailableCommand[] {
    return this.#session.availableCommands
  }
  set availableCommands(v: AvailableCommand[]) {
    this.#session.availableCommands = v
  }
  get planStore(): PlanStore {
    return this.#session.planStore
  }
  set planStore(v: PlanStore) {
    this.#session.planStore = v
  }
  get contextUsage(): UsageUpdate | null {
    return this.#session.contextUsage
  }
  set contextUsage(v: UsageUpdate | null) {
    this.#session.contextUsage = v
  }
  get quota(): QuotaSnapshot | null {
    return this.#session.quota
  }
  set quota(v: QuotaSnapshot | null) {
    this.#session.quota = v
  }
  get quotaLoading(): boolean {
    return this.#session.quotaLoading
  }
  set quotaLoading(v: boolean) {
    this.#session.quotaLoading = v
  }

  get renderBubbles(): Bubble[] {
    return this.bubbles
  }

  get supportsImageInput(): boolean {
    return this.#capabilities?.image === true
  }

  get supportsSessionDelete(): boolean {
    return this.sessionsCache.supportsDelete(this.#view)
  }

  // ─── slice FE-normalization: capabilities + gating ─── (additive)

  /**
   * NormalizedCapabilities שהתקבלו מ-_drive/capabilities ext notification.
   * null = טרם התקבל (ה-BE שלח אבל FE עדיין לא קיבל, או לא in-process session).
   */
  get capabilities(): NormalizedCapabilities | null {
    return this.#capabilities
  }

  /**
   * showsSystemPromptWarning — האם להציג את אזהרת חוסר-התמיכה בפרומפט-פרויקט.
   *
   * ─── slice systemprompt-capability ───
   * **שלושה מצבים, לא שניים** (ממצא אביגיל):
   * - `capabilities === null` — טרם ידוע ⇒ **שקט**. לא אזהרה ולא הבטחה.
   * - `systemPrompt === "native" | "prepended"` — charter handled ⇒ שקט.
   * - `systemPrompt === "unsupported"` — לא נתמך ⇒ אזהרה.
   *
   * ⚠️ **לא להשתמש כאן ב-`supports`** — הוא מחזיר all-false כשהיכולות טרם
   * הגיעו, ולכן היה מציג אזהרת-שווא ב-claude/codex בכל חיבור וחיבור-מחדש.
   *
   * ⚠️ **התנאי חי כאן ולא בתבנית** כדי שבדיקת-מוטציה תוכל לתפוס אותו:
   * טסט שמעתיק את התנאי לרכיב-fixture עובר גם כשקוד הייצור שבור (ממצא כלב).
   */
  get showsSystemPromptWarning(): boolean {
    const caps = this.#capabilities
    return caps !== null && caps.systemPrompt === "unsupported"
  }

  /** Test hook ל-spike: כמה raw Claude SDK ext notifications התקבלו בחיבור הנוכחי. */
  get claudeRawSdkMessageCount(): number {
    return this.#claudeRawSdkMessageCount
  }

  /**
   * Helper gating — מחזיר אובייקט עם כל ה-caps (all false אם עדיין null).
   * UI: `{#if vm.supports.thinkingTokens}`.
   */
  get supports(): NormalizedCapabilities {
    return (
      this.#capabilities ?? {
        mcp: false,
        compact: false,
        commands: false,
        usage: false,
        configOptions: false,
        rename: false,
        thinkingTokens: false,
        image: false,
        systemPrompt: "unsupported",
      }
    )
  }

  sessionsCache = $state(new SessionsCacheScope())
  // ─── slice FE-normalization: capabilities ─── (additive)
  /** NormalizedCapabilities שהתקבלו מ-_drive/capabilities ext notification. null = טרם התקבל. */
  #capabilities = $state<NormalizedCapabilities | null>(null)
  #mockQuota: QuotaSnapshot | null | undefined = undefined
  /** Counter פנימי ל-spike raw SDK. לא נרנדר ב-UI. */
  #claudeRawSdkMessageCount = 0
  // ─── slice subagent-identity-gate: ניתוב תעתיק + שער זהות (חילוץ מ-VM) ───
  #subagentTranscript: SubagentTranscriptRouter
  /** slice connection-set C2: one id per VM lifetime — SSE header, presence, WS query, DELETE. */
  readonly #connectionId = safeUUID()
  #pageHideReleaseBound = false
  #sessionId = $state<string | null>(null)

  /**
   * Session-identity boundary. A new scope is born only when the incoming identity differs
   * from the one the current scope was born for (compare `#session.sessionId`, not `#sessionId`).
   */
  #enterSession(id: string | null): void {
    if (this.#session.sessionId !== id) this.#session = new SessionScope(id)
    this.#sessionId = id
  }

  #subagentToolNestingDeps(): SubagentToolNestingDeps {
    return {
      bubbles: () => this.bubbles,
      parents: () => this.#session.subagentToolCallParents,
      applyToolCall: (update) => this.#applyToolCall(update),
      setTurnState: (next) => this.#setTurnState(next),
    }
  }

  #sessionEndScopeDeps(): SessionEndScopeDeps {
    return { sessionEndListeners: () => this.#sessionEndListeners }
  }

  #applyConfigOptionDeps(): ApplyConfigOptionDeps {
    return {
      configOptions: () => this.configOptions,
      status: () => this.status,
      view: () => this.#view,
      cliKind: () => this.#cliKind,
      settings: () => this.#settings,
    }
  }

  #captureSessionConfigDeps(): CaptureSessionConfigDeps {
    return {
      setConfigOptions: (v) => {
        this.configOptions = v
      },
      setModels: (v) => {
        this.models = v
      },
      setModes: (v) => {
        this.modes = v
      },
      setAvailableCommands: (v) => {
        this.availableCommands = v
      },
      setContextUsage: (v) => {
        this.contextUsage = v
      },
      setQuota: (v) => {
        this.quota = v
      },
      setQuotaLoading: (v) => {
        this.quotaLoading = v
      },
      setMockQuota: (v) => {
        this.#mockQuota = v
      },
      session: () => this.#session,
      setPlanStore: (v) => {
        this.planStore = v
      },
    }
  }

  #deleteSessionDeps(): DeleteSessionDeps {
    return {
      view: () => this.#view,
      sessionId: () => this.#sessionId,
      cache: () => this.sessionsCache,
      cliKind: () => this.#cliKind,
      detachWith: (reason) => this.#detachWith(reason),
    }
  }
  /**
   * Preserve a terminal attachment error until the next attachment begins.
   */
  #errorSurfaced = false

  // ─── slice view-switch C3-ו: guard-זהות ל-pending (remote) ─── (additive)
  /**
   * ה-id שזה עתה נענה, פר-סוג — סוגר patch-מעופש (BE שרת פותר pending, ולכן patch
   * שהגיע אחרי שכבר עניתי הוא "reply שהוקדם" — no-op). ❌ אין #openPermissionId: "מה
   * פתוח כרגע" נקרא מהמקור היחיד (pendingPermission?.requestId), לא ממצב-מראה שני.
   * ⚠️ requestId הוא פר-host ומתחיל מ-0 בכל agent חדש — מאופס ב-attachRemote וב-#cleanup.
   */
  #answeredPermissionId: number | null = null
  #answeredElicitationId: number | null = null
  /**
   * ה-error string שהסנכרון מ-lastTurnError עצמו כתב — מאפשר ניקוי ממוקד (תור חדש
   * מנקה רק באנר שמקורו כאן; אזהרה אחרת — reply failed / כשל-שיגור — שורדת, מכוון).
   */
  #errorFromTurn: string | null = null

  // ─── slice ws-reconnect-infra: reconnect internals ───
  /** ה-cliKind של ה-attach/loadSession האחרון — נדרש ל-cold reconnect.
   * $state כדי שה-getter הציבורי יהיה ריאקטיבי (slice cli-name-in-chat). */
  #cliKind = $state<string | null>(null)

  // ─── slice session-view-port C3: SessionView patch consumer ───

  /**
   * קורא מ-view.patches ומעדכן bubbles + metadata ב-VM.
   * רץ ברקע (אסינכרוני) ב-loop אינסופיני עד שה-stream נסגר.
   * כל batch patches: עדכון bubbles ביעד (applyPatchMutable) + סינכון metadata.
   */
  ingestView = (): SessionView | null => this.#view
  ingestOnSessionUpdate = (n: { update: unknown }): void =>
    this.#onSessionUpdate(n as SessionNotification)
  ingestSyncFromViewState = (s: SessionState): void => this.#syncFromViewState(s)
  ingestNoteAgentActivity = (): void => this.#noteAgentActivity()
  ingestSetHistoryMark = (m: HistoryMark): void => {
    this.#historyMark = m
  }
  ingestApplyHistoryState = (s: NonNullable<ViewEmission["historyState"]>): void =>
    this.#historyState.applyEmission(s)

  async #consumeViewPatches(view: SessionView): Promise<void> {
    bindHistory(this.#historyState, view)
    await consumeViewPatches(historyIngestDepsFrom(this), view)
  }

  /**
   * מסנכן שדות metadata מ-SessionState (ישיר) לשדות ה-$state של ה-VM.
   * נקרא אחרי כל batch patches מ-view.patches.
   */
  #syncFromViewState(viewState: SessionState): void {
    const view = this.#view
    if (!view) return
    this.#noteAgentActivity()
    syncViewMetadata(this, viewState, (state) => this.#setTurnState(state), this.#capabilities,
      (value) => { this.#capabilities = value })
    this.#syncPendingPermission(viewState.pending.permission, view)
    this.#syncPendingElicitation(viewState.pending.elicitation, view)
    this.#errorFromTurn = syncViewTurnError(this, viewState, this.#errorFromTurn)
  }

  /**
   * מסנכן pending.permission — ארבעה מצבים, בסדר הזה (slice view-switch C3-ו.1):
   *   null                                → pendingPermission = null
   *   requestId === #answeredPermissionId → patch מעופש, דלג
   *   requestId === pendingPermission?.requestId → כבר פתוח, אל תבנה מחדש
   *   אחרת                                 → בנה { requestId, params, resolve }
   */
  #syncPendingPermission(incoming: SessionState["pending"]["permission"], view: SessionView): void {
    if (incoming === null) {
      this.pendingPermission = null
      return
    }
    if (incoming.requestId === this.#answeredPermissionId) return
    if (incoming.requestId === this.pendingPermission?.requestId) return
    const id = incoming.requestId
    this.pendingPermission = {
      requestId: id,
      params: incoming.params as unknown as PermissionParams,
      resolve: (r: PermissionResponse) => {
        try {
          this.#answeredPermissionId = id // אופטימי — חוסם patch מעופש
          void view.respond(id, r).catch(() => {
            // ⚠️ מכומת בזהות ובזמן: #cleanup קורא pending.resolve(...) ואז מוחק את
            // ה-agent באותו tick ⇒ ה-respond מובטח להידחות. בלי הכימות, זה היה כותב
            // #answeredPermissionId/error לתוך הסשן שיהיה נוכחי כשזה נפתר (רפאים).
            if (this.#view !== view) return
            this.#answeredPermissionId = null // ביטול הסימון — יוכל להיפתח שוב
            this.error = "reply failed"
          })
        } catch {
          // ה-shim לעולם לא זורק — #cleanup קורא לו בלי try/catch מסביב
        }
      },
    }
  }

  /** מקביל ל-#syncPendingPermission — אותם ארבעה מצבים, אותו נימוק, לסוג elicitation. */
  #syncPendingElicitation(
    incoming: SessionState["pending"]["elicitation"],
    view: SessionView,
  ): void {
    if (incoming === null) {
      this.pendingElicitation = null
      return
    }
    if (incoming.requestId === this.#answeredElicitationId) return
    if (incoming.requestId === this.pendingElicitation?.requestId) return
    const id = incoming.requestId
    this.pendingElicitation = {
      requestId: id,
      params: incoming.params as unknown as ElicitationParams,
      resolve: (r: ElicitationResponse) => {
        try {
          this.#answeredElicitationId = id
          void view.respond(id, r).catch(() => {
            if (this.#view !== view) return
            this.#answeredElicitationId = null
            this.error = "reply failed"
          })
        } catch {
          // ה-shim לעולם לא זורק
        }
      },
    }
  }

  // ─── DEV-only test helpers (tree-shaken from prod) ───
  /**
   * @internal slice http-state-gaps C4 — קריאה בלבד, לטסטים.
   * #sessionId אינו חשוף, ולכן השמה שגויה שלו לא ניתנת לתפיסה בטסט.
   */
  _sessionIdForTest(): string | null {
    return this.#sessionId
  }

  // ─── slice liveness C4: SSE reconnect → ניקוי באנר presence (לא נוגע ב-session.error) ───
  #sseReconnectedListener: (() => void) | null = null

  setSseReconnectedListener(listener: (() => void) | null): void {
    this.#sseReconnectedListener = listener
  }

  // ─── slice session-scope-core S1: session-end boundary (additive) ───
  #sessionEndListeners: Array<(reason: SessionEndReason) => void> = []

  /** Registers a listener for session-scope end. Returns unsubscribe. Listeners run in registration order. */
  onSessionEnd(cb: (reason: SessionEndReason) => void): () => void {
    return registerSessionEndListener(this.#sessionEndScopeDeps(), cb)
  }

  #endSessionScope(reason: SessionEndReason): void {
    endSessionScope(this.#sessionEndScopeDeps(), reason)
  }

  /** Fires session-end with reason "navigate". No-op when status is "idle" (never opened, or already torn down). */
  notifySessionNavigatedAway(): void {
    if (this.status === "idle") return
    void this.#leaveSession("navigate", true).catch((e) => {
      this.error = formatAcpError(e)
    })
  }

  // slice http-live-side-effects: onSseReconnected אינו אופציונלי יותר — הגוף מספק אותו תמיד.
  #connectRemoteView(agentId: string) {
    return createRemoteView({
      agentId,
      transport: this.#sessionTransport,
      headers: { "Acp-Connection-Id": this.#connectionId },
      onSseReconnected: () => this._onSseReconnectedForTest(),
    })
  }

  /**
   * @internal slice http-live-side-effects — המסלול האמיתי של onSseReconnected.
   * שגיאה חולפת (switchSession/newSession) נמחקת ב-reconnect; טרמינלית (#errorSurfaced) שורדת.
   */
  _onSseReconnectedForTest(): void {
    if (!this.#errorSurfaced) this.error = null
    this.#sseReconnectedListener?.()
  }

  get connectionId(): string {
    return this.#connectionId
  }

  releaseConnection(): void {
    const agentId = this.agentId
    if (!agentId) return
    void releaseConnection(agentId, this.#connectionId)
  }

  bindConnectionRelease(): void {
    if (typeof window === "undefined" || this.#pageHideReleaseBound) return
    this.#pageHideReleaseBound = true
    window.addEventListener("pagehide", this.#onPageHideRelease)
  }

  #onPageHideRelease = (): void => {
    this.releaseConnection()
  }

  /** @internal */ _setStatusForTest(s: AgentSessionStatus): void {
    this.#setStatus(s)
  }
  /**
   * @internal מזריק את #errorSurfaced ישירות (calev-heavy §10.2, Commit 4) — מאפשר
   * לטסטים לדמות מצב "כשל טרמינלי כבר הוצג" (attach/loadSession) בלי לעבור דרך
   * ה-catch המלא (createAgent/WS/ACP handshake מלא).
   */
  _setErrorSurfacedForTest(v: boolean): void {
    this.#errorSurfaced = v
  }
  /**
   * @internal slice session-budget-meter Commit 4 — מזריק #mockQuota ישירות לטסט,
   * בלי תלות ב-fixture JSON (ה-wiring האמיתי דרך mockState.quota מגיע ב-Commit 5).
   */
  _setMockQuotaForTest(q: QuotaSnapshot | null | undefined): void {
    this.#mockQuota = q
  }
  /**
   * @internal מגדיר #sessionId + cwd + #cliKind ישירות — כדי ש-reconnect() לא יחזור מוקדם.
   */
  _setSessionContextForTest(ctx: { sessionId: string; cwd: string; cliKind: string }): void {
    this.#enterSession(ctx.sessionId)
    this.cwd = ctx.cwd
    this.#cliKind = ctx.cliKind
  }

  /** Starts a new backend-owned session and connects its view. */
  attachRemote = async (input: {
    cwd: string
    cliKind: string
    systemPrompt?: string | null
    transport: SessionTransport
  }): Promise<void> => {
    // 0. ⚠️⚠️ בדיקת חיבור כפול קודמת לניקוי
    // (חיבור-חוזר במצב connected היה הורג agent+host+תת-תהליך חי לפני שהוא זורק).
    if (this.status === "connecting" || this.status === "connected") {
      throw new Error(`cannot attach in status ${this.status}`)
    }
    // 0ב. ⚠️ פרק #view קיים דרך #cleanup() — לא ידנית (deleteAgent חי רק שם).
    this.#cleanup()

    // 1. בלוק-איפוס זהה ל-attach + איפוס מרחב-ה-ids של pending (guard-זהות, ר' C3-ו)
    this.error = null
    this.authMethods = []
    this.#errorSurfaced = false
    this.bubbles = []
    this.#answeredPermissionId = null
    this.#answeredElicitationId = null

    this.#setStatus("connecting")
    this.cwd = input.cwd
    this.#cliKind = input.cliKind
    this.#sessionTransport = input.transport

    let attached = false
    try {
      // 3. HTTP בלבד. מיד אחריו: agentId מוצב — #cleanup מוחק לפיו; אם ההשמה נדחית
      // לשלב 6, הניקוי בשלב 5 או 8 לא יקבל את המזהה,
      // וה-agent+host+child שנוצרו כאן מדליפים.
      const { agentId } = await createAgent({
        cwd: input.cwd,
        cliKind: input.cliKind,
        systemPrompt: input.systemPrompt,
      })
      this.agentId = agentId

      // 4.
      const view = await this.#connectRemoteView(agentId)

      // 5. כשל-מהיר: אם ה-BE לא סיפק sessionId — סגור + #cleanup (agent/host/child כבר
      // נוצרו בשלב 3; close() לבדו לא מוחק את ה-agent, רק #cleanup עושה זאת).
      if (view.state.sessionId == null) {
        await view.close()
        this.#cleanup()
        this.error = "remote mode: backend did not provide a sessionId"
        this.#errorSurfaced = true
        this.#setStatus("error")
        return
      }

      // slice http-cold-parity: אימוץ ה-sessionId מהסנאפשוט — תקדים חי זהה ב-
      // attachRemoteToLiveAgent (slice http-state-gaps C4). מיד אחרי בלוק הכשל-המהיר
      // (שכבר הבטיח view.state.sessionId != null) ולפני this.#view = view.
      this.#enterSession(view.state.sessionId)

      // 6.
      this.#view = view
      void this.#consumeViewPatches(view)
      this.#setStatus("connected")
      attached = true
    } catch (e) {
      // 8. כל שלבים 3-6 עטופים — createAgent/connect() שנדחים לא ישאירו status="connecting" לנצח
      this.#cleanup()
      Object.assign(this, sessionAttachFailure(e))
      this.#errorSurfaced = true
      this.#setStatus("error")
    }
    // slice http-cold-parity: שחזור-בחירות best-effort — בכוונה מחוץ ל-try. גרסה
    // שמניחה את זה בתוך ה-try הופכת כשל-RPC חולף אחד לחיבור-מוצלח→status="error"+
    // #cleanup() — הורגת agent+host+child שזה עתה נוצרו. ר' הבריף §4/Commit 1#4.
    // ⚠️ דגל מקומי ולא `this.status === "connected"`: השומר בראש המתודה מצמצם את
    // הטיפוס של this.status, ו-TS אינו עוקב אחרי ההשמה שבתוך #setStatus — לכן
    // ההשוואה סומנה כ"בלתי-אפשרית". הדגל מבטא את אותו תנאי בדיוק, ונראה ל-TS.
    if (attached) {
      try {
        await this.#applyRememberedConfig()
      } catch {
        /* שחזור-בחירות הוא נוחות, לא תנאי-חיבור */
      }
    }
  }

  // ─── slice remote-warm-reconnect C3: attachRemoteToLiveAgent ───

  /** Connects a view to an existing backend agent. */
  attachRemoteToLiveAgent = async (
    input: {
      agentId: string
      cwd: string
      cliKind: string
      transport: SessionTransport
    } & ManualTitleInput,
  ): Promise<void> => {
    // 0. ⚠️⚠️ קודם guard-הכפילות, ורק אחריו #cleanup() — אותו סדר קריטי כמו attachRemote
    // (חיבור-חוזר במצב connected היה הורג חיבור קיים לפני שהוא זורק).
    if (this.status === "connecting" || this.status === "connected") {
      throw new Error(`cannot attach in status ${this.status}`)
    }
    // 0ב. פרק חיבור קיים דרך #cleanup() — לא ידנית.
    this.#cleanup()

    // 1. בלוק-איפוס זהה ל-attachRemote + איפוס מרחב-ה-ids של pending (guard-זהות)
    this.error = null
    this.authMethods = []
    this.#errorSurfaced = false
    this.bubbles = []
    this.#answeredPermissionId = null
    this.#answeredElicitationId = null

    this.#setStatus("connecting")
    this.agentId = input.agentId
    this.cwd = input.cwd
    this.#cliKind = input.cliKind
    this.#sessionTransport = input.transport

    try {
      // 3. ללא createAgent — ה-host קיים ב-BE. createRemoteView כבר קורא connect()
      // בעצמו (memoized, M8); החתימה מקבלת אובייקט opts (התקדים attachRemote:1204).
      const view = await this.#connectRemoteView(input.agentId)

      // 4. כשל-מהיר: sessionId מה-snapshot (מקור-האמת). ⚠️ סטייה מודעת מהבריף:
      // keepAgent:true — #cleanup() רגיל קורא deleteAgent(agentId), והיה הורג את
      // הסוכן **החי** שאנחנו מתחברים אליו (ב-attachRemote הסוכן נוצר באותה מתודה
      // ולכן מחיקה נכונה; כאן הסוכן שייך למשתמשת וחייב לשרוד כשל).
      if (view.state.sessionId == null) {
        await view.close()
        this.#cleanup({ keepAgent: true })
        this.error = "remote mode: backend did not provide a sessionId"
        this.#errorSurfaced = true
        this.#setStatus("error")
        return
      }

      this.#enterSession(view.state.sessionId)
      if (this.agentId === input.agentId) applyManualTitleFromAttach(this, input, false)

      // 5. #consumeViewPatches מכמת בזהות (this.#view !== view → break) — כמו attachRemote.
      this.#view = view
      void this.#consumeViewPatches(view)

      // 6.
      this.#setStatus("connected")
    } catch (e) {
      // 8. כל השלבים עטופים — כשל לא משאיר status:"connecting" לנצח. keepAgent:true —
      // ר' שלב 4: הסוכן החי ב-BE שורד גם כשל-חולף (רשת/503), המשתמשת יכולה לנסות שוב.
      this.#cleanup({ keepAgent: true })
      Object.assign(this, sessionAttachFailure(e))
      this.#errorSurfaced = true
      this.#setStatus("error")
    }
  }

  detach = (): void => {
    this.#detachWith("detach")
  }

  #detachWith(reason: SessionEndReason): void {
    this.#leaveSession(reason, false).catch((e) => {
      this.error = formatAcpError(e)
      this.#errorSurfaced = true
    })
  }

  async #leaveSession(reason: SessionEndReason, keepAgent: boolean): Promise<void> {
    this.#endSessionScope(reason)
    if (keepAgent && (this.pendingPermission || this.pendingElicitation)) {
      this.#resolvePendingPermission({ outcome: { outcome: "cancelled" } })
      this.#resolvePendingElicitation({ action: "cancel" })
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    this.#cleanup(keepAgent ? { keepAgent: true } : undefined)
    this.#setStatus("idle")
    this.error = null
    this.bubbles = []
  }

  /** Leave session without killing the BE agent — child survives for reconnect / process list. */
  leaveRunning = async (): Promise<void> => {
    await this.#leaveSession("leave-running", true)
  }

  /** האם הסשן הנוכחי במצב עקיפת-הרשאות (claude בלבד כרגע — ראה permission-mode.ts).
   * קורא משני מקורות: configOptions (מתעדכן חי דרך config_option_update) ואז
   * fallback ל-modes.currentModeId (מתעדכן רק ב-mode_update, שלא תמיד מגיע מ-claude).
   */
  get bypassActive(): boolean {
    // configOptions מתעדכן חי ב-claude — נעדיף אותו כמקור ראשון.
    const modeOpt = this.configOptions.find((o) => o.category === "mode")
    const liveModeId =
      modeOpt && modeOpt.type === "select"
        ? (modeOpt as Extract<SessionConfigOption, { type: "select" }>).currentValue
        : undefined
    return isBypassMode(this.#cliKind, liveModeId ?? this.modes?.currentModeId)
  }

  /** ה-CLI של הסשן הפעיל (claude/opencode/codex), או null כשאין סשן. slice cli-name-in-chat. */
  get cliKind(): string | null {
    return this.#cliKind
  }

  get sessionId(): string | null {
    return this.#sessionId
  }

  /** המשתמש בחר אפשרות — פותר את ה-Promise הממתין עם ה-optionId שנבחר. */
  resolvePermission = (optionId: string): void => {
    this.#resolvePendingPermission({ outcome: { outcome: "selected", optionId } })
  }

  /** המשתמש ביטל/דחה בלי לבחור אפשרות ספציפית — פותר כ-cancelled. */
  cancelPermission = (): void => {
    this.#resolvePendingPermission({ outcome: { outcome: "cancelled" } })
  }

  /**
   * helper מרוכז — נקודת-פתרון יחידה ל-pendingPermission. idempotent (no-op אם null).
   * Cleanup and turn cancellation resolve a pending permission here.
   */
  #resolvePendingPermission(response: PermissionResponse): void {
    const pending = this.pendingPermission
    if (!pending) return
    pending.resolve(response)
    this.pendingPermission = null
  }

  /** המשתמש מילא את הטופס ואישר — פותר את ה-Promise הממתין עם ה-content שהוזן. */
  resolveElicitation = (content: Record<string, string | number | boolean | string[]>): void => {
    this.#resolvePendingElicitation({ action: "accept", content })
  }

  /** המשתמש ביטל/דחה — פותר עם action (decline|cancel). */
  cancelElicitation = (action: "decline" | "cancel"): void => {
    this.#resolvePendingElicitation({ action })
  }

  /**
   * helper מרוכז — נקודת-פתרון יחידה ל-pendingElicitation. idempotent (no-op אם null).
   * Cleanup and turn cancellation resolve a pending elicitation here.
   */
  #resolvePendingElicitation(response: ElicitationResponse): void {
    const pending = this.pendingElicitation
    if (!pending) return
    pending.resolve(response)
    this.pendingElicitation = null
  }

  // ─── פרומפטים (prompting) ────────────────────────────────────

  sendPrompt = (text: string, opts?: LegacyPromptOptions): Promise<void> =>
    sendLegacyPrompt(this, this.#view, (state) => this.#setTurnState(state), text, opts)

  /** Opens a fixture session from the development chat route. */
  openMockSession = async (name: string, cwd: string): Promise<void> => {
    if (import.meta.env.MODE === "production") return
    if (this.status === "connecting" || this.status === "connected") {
      throw new Error(`cannot open mock session in status ${this.status}`)
    }
    this.#endSessionScope("load")
    this.agentId = null
    this.agentNotes = ""
    this.agentFields = {}
    this.#setStatus("connecting")
    this.error = null
    this.authMethods = []
    this.#errorSurfaced = false
    this.bubbles = []
    await loadMockSession(this.#loadMockSessionDeps(), name, cwd)
  }

  switchSession = (input: ListedSessionInput): Promise<void> =>
    switchListedSession(this, this.#view, input, {
      endScope: () => this.#endSessionScope("switch"),
      enterSession: (id) => this.#enterSession(id),
      applyTitle: () => applyTitleFromSessionInput(this, input),
    })

  newSession = (input: { cwd?: string; cliKind: string }): Promise<void> =>
    newListedSession(this, this.#view, input, {
      endScope: () => this.#endSessionScope("new"),
      enterSession: (id) => this.#enterSession(id),
      attach: (cwd) =>
        this.attachRemote({ cwd, cliKind: input.cliKind, transport: this.#sessionTransport }),
      clearSurfacedError: () => {
        this.#errorSurfaced = false
      },
      applyRememberedConfig: () => this.#applyRememberedConfig(),
    })

  // ─── slice 4: עזרי הקשר לקריינות ─── (תוספתי)

  /**
   * מחזיר את הטקסט של ה-n MessageBubbles האחרונות של הסייען כמחרוזות.
   * משמש את ה-Speaker כדי לבנות NarrateContext עבור קריינות קריאה לכלי.
   */
  recentAssistantMessages(n: number = 3): string[] {
    const result: string[] = []
    for (let i = this.bubbles.length - 1; i >= 0 && result.length < n; i--) {
      const b = this.bubbles[i]
      if (b?.kind === "message") {
        result.unshift(b.segments.map((s) => s.text).join(""))
      }
    }
    return result
  }

  // ─── slice 23: session config ─── (תוספתי)

  /**
   * מחיל שינוי config על הסשן הפתוח. קורא ל-setSessionConfigOption עם
   * discriminated fallback ל-setSessionModel/setSessionMode.
   * מדלג בשקט אם הסשן לא מחובר.
   *
   * ─── slice-restore-last-config: wrapper ───
   * הגוף האמיתי הועבר ל-#applyConfigToClient שמחזיר boolean (הצליח/לא נמצא).
   * guard של status/client+sessionId נשאר כאן.
   * persist נקרא רק אם applied===true — כיסוי כל 5 מסלולי-ההצלחה.
   */
  applyConfigOption = async (configId: string, value: string | boolean): Promise<void> => {
    await applyConfigOptionExtracted(this.#applyConfigOptionDeps(), configId, value)
  }

  setThinkingTokens = async (n: number | null): Promise<void> => {
    if (this.status !== "connected") return
    await setThinkingTokens(this.#view, this.#sessionId, n)
  }

  /** Production quota comes from the host. Mock sessions populate their fixture on open. */
  refreshQuota = (): Promise<void> => {
    if (
      import.meta.env.MODE !== "production" &&
      this.#sessionId?.startsWith("mock:") &&
      this.#mockQuota !== undefined
    ) {
      this.quota = this.#mockQuota
    }
    return Promise.resolve()
  }

  // ─── slice-restore-last-config: apply remembered config ─── (תוספתי)

  /**
   * האם value עדיין תקף מול ה-options שה-CLI מחזיר כרגע?
   * בודק ערך (לא רק קיום option) — ערך stale שה-CLI הסיר נדלג בשקט.
   *
   * מבנים מאומתים מול dev:
   *   modes.availableModes[].id
   *   models.availableModels[].modelId (לא .id!)
   *   SessionConfigOption = discriminated union { type:"select"|"boolean" }
   */
  #isValidChoice(key: string, value: string | boolean): boolean {
    return isValidChoice(this, key, value)
  }

  /**
   * מחיל את הבחירות האחרונות של המשתמשת (מ-#settings.lastConfig) על הסשן החדש.
   *
   * ⚠️ חובה לקרוא **אחרי** this.#setStatus("connected") —
   * applyConfigOption חוסם כש-status≠connected (no-op שקט אחרת).
   *
   * ⚠️ applyConfigOption קורא ל-setLastConfig (persist) — idempotent (כותב את אותו ערך).
   *
   * נקרא רק מ-attach ו-newSession (סשן חדש). loadSession/switchSession (resume) — לא.
   */
  async #applyRememberedConfig(): Promise<void> {
    const cli = this.#cliKind
    const remembered = cli ? this.#settings?.lastConfig[cli] : undefined
    if (!remembered) return
    for (const [key, value] of Object.entries(remembered)) {
      if (this.#isValidChoice(key, value)) {
        await this.applyConfigOption(key, value)
      }
    }
  }

  // ─── redesign-fix: רשימת סשנים inline ─── (תוספתי)

  /**
   * Read the session list through the current view. Force refresh bypasses the cache.
   * (slice connect-recent-projects: דף החיבור כבר לא משתמש ב-spawn — הוסר listSessionsForCwd.
   *  בחירת סשן נעשית מתוך הסשן הפעיל דרך SessionOptionsPanel.)
   */
  listSessions = async (force = false, query?: SessionListQuery): Promise<void> => {
    if (this.#view) await this.sessionsCache.list(this.#view, force, query)
  }

  loadMoreSessions = async (): Promise<void> => {
    if (this.#view) await this.sessionsCache.loadMore(this.#view)
  }

  findListedSession = (sessionId: string): Promise<SessionInfo | undefined> => {
    const view = this.#view
    return view
      ? findListedSession(view, sessionId, () => this.#view === view)
      : Promise.resolve(undefined)
  }

  // ─── slice session-delete: מחיקת סשן (session/delete) ─── (תוספתי)
  /**
   * מוחק session מ-`session/list` (store/persistence) דרך ACP `session/delete` — **לא**
   * הורג את ה-process (זה נעשה בנפרד ע"י `DELETE /api/agents/:id`, מסלול שונה — §1 הבריף).
   * Deletion requires an attached view.
   *
   * אם הסשן הנמחק הוא הסשן הפעיל (`#sessionId`) → `detach()` (ניווט-החוצה, עקבי עם
   * `onDisconnect` הקיים ב-`SessionOptionsPanel`) — אין טעם להשאיר תהליך חי לסשן שכבר לא
   * קיים ב-`session/list`; ה-UI (route) מגיב ל-`status` שהופך ל-`idle` ומנווט.
   *
   * -32601 (method not found — הכפתור לא אמור להופיע בכלל אם ה-gate תקין, אבל defensive)
   * מטופל בעדינות כמו `listSessions` — לא נזרק ל-UI כשגיאה.
   */
  /**
   * מוחק סשן מ-`session/list`. מחזיר `true` אם נמחק הסשן ה**פעיל** — כדי שהקומפוננטה
   * תנווט החוצה (`goto("/")`), עקבי עם דפוס `onDisconnect`/`doLeaveRunning` שבו הניווט
   * חי בשכבת הקומפוננטה ולא ב-VM. (calev NO-GO fix: DoD #7 — active-delete השאיר /chat ריק.)
   */
  deleteSession = async (sessionId: string): Promise<boolean> => {
    return deleteSessionExtracted(this.#deleteSessionDeps(), sessionId)
  }

  // ─── הקלטות (recordings) ─── (יתווסף ב-slice 10)

  // ─── msr-v2: cancelTurn ─── (additive)

  /**
   * מבטל את התור הנוכחי דרך ACP cancel. הסוכן מפסיק לייצר.
   * מאלץ turnState=idle מיידית (לא מחכה ל-sendPrompt resolved). no-op אם אין תור פעיל.
   */
  cancelTurn = async (): Promise<void> => {
    if (this.turnState === "idle") return
    // slice-permission-ui-basic: ביטול תור באמצע בקשת-הרשאה ממתינה → פתור כ-cancelled.
    // נתיב עצמאי — לא עובר דרך #cleanup (הסיכון #1, §4 Commit 2).
    this.#resolvePendingPermission({ outcome: { outcome: "cancelled" } })
    // slice-elicitation-ui: אותו דפוס — ביטול תור באמצע שאלה מובנת ממתינה → פתור כ-cancel.
    this.#resolvePendingElicitation({ action: "cancel" })
    const view = this.#view
    if (!view) return
    try {
      await view.cancel()
    } catch {
      // Cancellation is best-effort.
    }
    this.#setTurnState("idle")
  }

  setManualTitle(title: string): void {
    setManualTitleOnAgent(this, title)
  }

  // ─── slice 6: setter מרכז ─── (additive — מנתב את כל ה-status writes)

  /**
   * Applies status transitions that can play a cue. Terminal view emissions mark a silent disconnect.
   * מנגן audio cue ב-transitions רלוונטיים (slice 6). אין $effect — קריאה מפורשת.
   * idempotent: אם next === prev — לא מנגן cue (אין transition).
   *
   */
  #setStatus(next: AgentSessionStatus): void {
    const prev = this.status
    if (next === prev) return
    this.status = next
    if (next === "error") this.#cues?.play("error")
  }

  // ─── msr-v2: setter ל-turnState ───

  /**
   * נקודת-mutation יחידה ל-turnState. אין $effect — קריאה מפורשת.
   * מנגן cue "thinking" על מעבר idle→waiting (פעם אחת ביציאה מ-idle).
   * idempotent: אם next === prev — לא מנגן cue.
   */
  #setTurnState(next: TurnState): void {
    const prev = this.turnState
    if (next === prev) return
    this.turnState = next
    // cue thinking: רק על מעבר idle→waiting (תחילת תור חדש)
    if (prev === "idle" && next === "waiting") this.#cues?.play("thinking")
    // ─── watchdog לתור (slice liveness §2) ───
    // הנקודה היחידה שבה תור באמת נפתח/נסגר, ולכן כאן מסונכרן מצב-הפעילות.
    if (prev === "idle") {
      this.#turnActivity = onTurnStarted(Date.now())
      this.turnStalled = false
    } else if (next === "idle") {
      this.#turnActivity = onTurnEnded()
      this.turnStalled = false
    }
  }

  // ─── watchdog לתור ─── (slice liveness §2)
  /**
   * חיווי בלבד: התור פעיל ולא הגיע ממנו דבר זמן רב. **אינו מבטל** — הפעולה
   * נשארת בידי המשתמשת (כפתור-הביטול הקיים). ר' `engines/turn-watchdog.ts`
   * להסבר מלא, כולל למה הקריטריון הוא "אין פעילות" ולא "אין טקסט".
   */
  turnStalled = $state(false)
  #turnActivity: TurnActivityState = initialTurnActivity()
  #stallTimer: ReturnType<typeof setInterval> | undefined

  /**
   * פעילות מהסוכן. נקרא משני הטרנספורטים (WS ו-HTTP) — לכן הוא כאן ב-VM
   * ולא באחד מהם. **כל** פריים נחשב, לא רק טקסט.
   */
  #noteAgentActivity(): void {
    this.#turnActivity = onActivity(this.#turnActivity, Date.now())
    if (this.turnStalled) this.turnStalled = false
  }

  /** מריץ את ההערכה מדי 5ש׳. הליבה טהורה; זה רק השעון סביבה. */
  #startStallWatch(): void {
    if (this.#stallTimer !== undefined) return
    this.#stallTimer = setInterval(() => {
      const verdict = evaluateTurn(this.#turnActivity, Date.now())
      if (verdict.kind === "ok") {
        if (this.turnStalled) this.turnStalled = false
        return
      }
      if (!this.turnStalled) {
        this.turnStalled = true
        connWarn("turn-stalled", { silentMs: verdict.silentMs, kind: verdict.kind })
      }
      // give-up: משחרר את ההמתנה שלנו בלבד. **אין** session/cancel לסוכן —
      // הכרעה מפורשת: הקוד לא מבטל תור מדעתו.
      if (verdict.kind === "give-up") this.#setTurnState("idle")
    }, 5_000)
  }

  #stopStallWatch(): void {
    if (this.#stallTimer !== undefined) {
      clearInterval(this.#stallTimer)
      this.#stallTimer = undefined
    }
  }

  // ─── פרטי ─────────────────────────────────────

  /** לוכד configOptions/models/modes מתגובת session/new או session/load */
  #captureSessionConfig(result: {
    configOptions?: SessionConfigOption[] | null
    models?: SessionModelState | null
    modes?: SessionModeState | null
  }): void {
    captureSessionConfig(this.#captureSessionConfigDeps(), result)
  }

  #cleanup(opts?: { keepAgent?: boolean }): void {
    // לכוד את ה-agentId לפני האיפוס — צריך אותו ל-deleteAgent.
    const agentId = this.agentId
    // watchdog §2 — אין תור בלי סשן.
    this.#stopStallWatch()
    this.#turnActivity = onTurnEnded()
    this.turnStalled = false
    this.#resolvePendingPermission({ outcome: { outcome: "cancelled" } })
    this.#resolvePendingElicitation({ action: "cancel" })
    if (opts?.keepAgent && this.#view) this.releaseConnection()
    // ─── slice view-switch C3-ח: teardown ה-view (remote) — נקודת-הפירוק היחידה ───
    // close() אינו זול (ממתין לשני round-trips של POST /reply לביטול pending) —
    // void חובה (אחרת #cleanup הסינכרונית הייתה צריכה להפוך ל-async). ה-.catch הוא
    // חגורת-ביטחון בלבד — close() תופס בפנים את שתי קריאות ה-respond.
    void this.#view?.close().catch(() => {})
    this.#view = null
    this.sessionsCache.reset()
    // ─── slice view-switch C3-ו: מרחב-ה-ids של pending הוא פר-host, לא פר-VM ───
    // בלי איפוס — הדיאלוג הראשון של הסשן המרוחק הבא באותו טאב מדוכא בשקט (id 0 "כבר נענה").
    this.#answeredPermissionId = null
    this.#answeredElicitationId = null
    this.#capabilities = null // slice FE-normalization: נקה capabilities (חיבור חדש = caps חדשים)
    this.contextUsage = null // slice session-budget-meter: נקה context-usage (חיבור חדש = caps חדשים)
    this.quota = null // slice session-budget-meter Commit 4: נקה quota
    this.quotaLoading = false
    this.#mockQuota = undefined
    this.#claudeRawSdkMessageCount = 0
    // slice subagent-identity-gate: ניתוב תעתיק חדש (חיבור חדש = router מחדש)
    this.#subagentTranscript = new SubagentTranscriptRouter(this.#subagentTranscriptDeps())
    // slice subagent-tool-nesting: נקה מיפוי-קינון (חיבור חדש = מיפוי חדש)
    this.#session.subagentToolCallParents = new Map()
    this.#sessionId = null
    this.agentId = null
    this.agentNotes = ""
    this.agentFields = {}
    this.#historyState.resetFields()
    if (!opts?.keepAgent && agentId) void deleteAgent(agentId).catch(() => {})
  }

  #loadMockSessionDeps(): LoadMockSessionDeps {
    return {
      setCwd: (cwd) => {
        this.cwd = cwd
      },
      setSessionTitle: (title) => {
        this.sessionTitle = title
      },
      setError: (error) => {
        this.error = error
      },
      setIsLoadingHistory: (v) => {
        this.isLoadingHistory = v
      },
      enterSession: (sessionKey) => this.#enterSession(sessionKey),
      captureSessionConfig: (result) => this.#captureSessionConfig(result),
      setMockQuota: (v) => {
        this.#mockQuota = v
      },
      setCapabilities: (v) => {
        this.#capabilities = v
      },
      setTurnState: (state) => this.#setTurnState(state),
      onSessionUpdate: (n) => this.#onSessionUpdate(n),
      setStatus: (status) => this.#setStatus(status),
    }
  }

  // ─── slice FE-normalization: ext notification handler ─── (additive)
  /**
   * מקבל ext notifications מה-SDK (default-routed).
   * `_drive/capabilities` → מאחסן ב-#capabilities (reactive via getter).
   * `_claude/sdkMessage` → מנותח ומקושר לבועת ה-Task האב (slice subagent-transcript-data-v2).
   * לא ב-#onSessionUpdate — capabilities מגיע כ-extNotification, לא כ-session/update.
   */
  #onExtNotification = (method: string, params: Record<string, unknown>): void => {
    if (method === "_claude/sdkMessage") {
      // finding #1: השאר את ה-counter — agent-session.capabilities.test.svelte.ts:191 מצפה 0→2.
      this.#claudeRawSdkMessageCount += 1
      this.#subagentTranscript.onSdkMessage(params)
      return
    }
    // finding #2: ענף _drive/capabilities (וכל ענף עתידי) — ללא שינוי.
    if (method === "_drive/capabilities") {
      this.#capabilities = params as unknown as NormalizedCapabilities
    }
  }

  /** Folds session updates emitted by the backend. */
  #onSessionUpdate = (notification: SessionNotification): void => {
    this.#onUpdateObserved?.(notification.update)
    this.#noteAgentActivity()

    // slice meta-passthrough Commit 4: ext notifications re-enter via HTTP wire wrapper.
    if (
      (notification.update as { sessionUpdate?: string }).sessionUpdate ===
      "_drive/ext_notification"
    ) {
      const ext = notification.update as { method?: unknown; params?: unknown }
      if (typeof ext.method === "string" && typeof ext.params === "object" && ext.params !== null) {
        this.#onExtNotification(ext.method, ext.params as Record<string, unknown>)
      }
      return
    }

    // מעטפת ACP: צורה של { sessionId, update: { sessionUpdate, content, messageId, ... } }
    // ה-messageId נמצא על אובייקט ה-update החיצוני (הרחבה לא יציבה של ACP).
    const update = notification.update as {
      sessionUpdate?: string
      content?: any
      messageId?: string | null
      // ─── slice 4: שדות של קריאה לכלי ───
      toolCallId?: string
      title?: string
      kind?: string
      rawInput?: unknown
      rawOutput?: unknown
      status?: ToolCall["status"]
      // ─── slice 16 ───
      locations?: unknown[] | null
    }

    // ─── slice 4: טיפול בהתראות של כלים לפני שומר הטקסט (text guard) ───
    // ההתראות tool_call / tool_call_update לא נושאות תוכן טקסט — חובה לטפל בהן
    // לפני השורה `if (!text) return`.
    if (update.sessionUpdate === "tool_call") {
      // slice subagent-tool-nesting §3: כלי-בן של תת-סוכן (parentToolUseId ב-_meta.claudeCode)
      // מקונן ב-subFrames של בועת ה-Task האב — לא top-level.
      const parentToolUseId = extractParentToolUseId(notification.update)
      if (parentToolUseId !== undefined) {
        handleSubagentToolCall(this.#subagentToolNestingDeps(), update, parentToolUseId)
      } else {
        this.#applyToolCall(update)
      }
      return
    }
    if (update.sessionUpdate === "tool_call_update") {
      // slice subagent-tool-nesting §3 (אביגיל #3/#6): ה-Map (מבוסס tool_call create) הוא
      // מקור-הקישור האמין — לא ה-_meta של ה-update עצמו (חלק מה-updates לא נושאים parent).
      if (
        update.toolCallId !== undefined &&
        this.#session.subagentToolCallParents.has(update.toolCallId)
      ) {
        handleSubagentToolCallUpdate(this.#subagentToolNestingDeps(), update)
      } else {
        // slice meta-passthrough §3(ד): HTTP wire never emits tool_call — nest from _meta on
        // tool_call_update when the map misses but the parent Task bubble already exists.
        const parentToolUseId = extractParentToolUseId(notification.update)
        const parentBubbleExists =
          parentToolUseId !== undefined &&
          this.bubbles.some((b) => b.kind === "tool" && b.toolCall.toolCallId === parentToolUseId)
        const childAlreadyTopLevel =
          update.toolCallId !== undefined &&
          this.bubbles.some((b) => b.kind === "tool" && b.toolCall.toolCallId === update.toolCallId)
        if (parentToolUseId !== undefined && parentBubbleExists && !childAlreadyTopLevel) {
          handleSubagentToolCall(this.#subagentToolNestingDeps(), update, parentToolUseId)
        } else {
          // סדר חובה: turnState פר-pending/in_progress לפני ה-no-op guard (idx===-1) של reduce (אביגיל #4)
          if (update.status === "pending" || update.status === "in_progress") {
            this.#setTurnState("calling-tool")
          }
          const { state: nextState, patches } = reduce(this.sessionState, notification.update)
          this.sessionState = nextState
          applyPatchMutable(this.bubbles, patches, { mapToolContent, mapLocations })
        }
      }
      return
    }

    // ─── slice acp-mode-config-sync: handlers ל-mode/config events ──────────
    // חובה לפני `if (!text) return` — events אלה לא נושאים content.text.
    if (update.sessionUpdate === "current_mode_update") {
      const modeId = (update as { currentModeId?: unknown }).currentModeId
      if (typeof modeId === "string") {
        this.modes = {
          availableModes: this.modes?.availableModes ?? [],
          currentModeId: modeId,
        }
      }
      return
    }
    if (update.sessionUpdate === "config_option_update") {
      const opts = (update as { configOptions?: unknown }).configOptions
      if (Array.isArray(opts)) {
        this.configOptions = opts as SessionConfigOption[]
      }
      return
    }
    // ─── slice-slash-commands Commit 0: available_commands_update ───────────
    if (update.sessionUpdate === "available_commands_update") {
      const cmds = (update as { availableCommands?: unknown }).availableCommands
      this.availableCommands = Array.isArray(cmds) ? (cmds as AvailableCommand[]) : []
      return
    }

    // ─── slice plan-todo-list Commit 1: plan / plan_update / plan_removed ───
    // לא נושאים content.text — חובה לטפל בהם לפני ה-gate `if (!text) return`.
    // reducePlan טהור (core): הקשחה מובנית, אף פעם לא זורק.
    if (
      update.sessionUpdate === "plan" ||
      update.sessionUpdate === "plan_update" ||
      update.sessionUpdate === "plan_removed"
    ) {
      this.planStore = reducePlan(this.planStore, update)
      return
    }

    // ─── slice session-budget-meter Commit 1: usage_update (ACP תקני) ───────
    // לא נושא content.text — חובה לטפל בו לפני ה-gate `if (!text) return`.
    // cost אופציונלי + anti-flicker WS (נרמול object/number ב-core reduce.ts)
    if (update.sessionUpdate === "usage_update") {
      const u = update as unknown as UsageUpdate
      this.contextUsage = {
        used: u.used,
        size: u.size,
        cost: u.cost ?? this.contextUsage?.cost,
      }
      return
    }

    // ─── slice session-titles Commit 0: session_info_update (ACP תקני) ─────
    // לא נושא content.text — חובה לטפל בו לפני ה-gate `if (!text) return`.
    // semantics עקבי עם ה-keep-on-undefined הקיים ב-sessionTitle setter paths (:999, :1114).
    if (update.sessionUpdate === "session_info_update") {
      applyTitleFromSessionInfo(this, (update as { title?: string | null }).title)
      return
    }

    if (update.sessionUpdate === "agent_message_chunk") {
      if (!update.content || (update.content.type === "text" && !update.content.text)) return
      this.#setTurnState("responding")
    }

    if (update.sessionUpdate === "agent_thought_chunk") {
      if (!update.content || (update.content.type === "text" && !update.content.text)) return
      this.#setTurnState("thinking")
    }

    // ── default arm: everything not handled above ──
    // _drive/reset: patch path owns bubble reset (hydration/SSE have updates:[]).
    if (update.sessionUpdate === "_drive/reset") return

    const { state: nextState, patches } = reduce(this.sessionState, notification.update)
    this.sessionState = nextState
    applyPatchMutable(this.bubbles, patches, { mapToolContent, mapLocations })
  }

  // ─── slice session-state-reducer C4: מתודת-עזר ל-tool_call create (reduce + patches + flush + turnState) ───

  /**
   * #applyToolCall — מיישג tool_call create דרך reduce + applyPatchMutable.
   * קרוא משני מקומות: (1) dispatch tool_call של #onSessionUpdate (non-subagent),
   * (2) fallback של #handleSubagentToolCall (אב לא נמצא — אביגיל r4 #1).
   */
  #applyToolCall(update: Record<string, unknown>): void {
    const { state: nextState, patches } = reduce(this.sessionState, {
      ...update,
      sessionUpdate: "tool_call",
    })
    this.sessionState = nextState
    applyPatchMutable(this.bubbles, patches, { mapToolContent, mapLocations })
    // flush pending subagent events for this toolCallId (slice subagent-transcript-data-v2)
    if (typeof update.toolCallId === "string") {
      this.#subagentTranscript.flush(update.toolCallId)
    }
    // turnState תמיד calling-tool ללא תנאי (create, לא update)
    this.#setTurnState("calling-tool")
  }
}
