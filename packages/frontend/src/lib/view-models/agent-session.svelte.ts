/**
 * AgentSession — view-model מינימלי עבור סשן ACP יחיד.
 *
 * מנהל (Owns):
 *   - מצב חיבור (status, error)
 *   - הצטברות בועות (bubble accumulation) מהתראות session/update
 *   - מתודות ציבוריות: attach/detach/sendPrompt
 *
 * משתמש ב-AcpClient האגנוסטי לתעבורה מתוך @drive-coding/provider/client,
 * עטוף עם ה-WsAcpTransport מצד ה-FE.
 */

import type {
  AuthMethod,
  AvailableCommand,
  SessionConfigOption,
  SessionModeState,
  UsageUpdate,
} from "@agentclientprotocol/sdk"
import { WsAcpTransport } from "@drive-coding/acp-wire/browser"
// ─── slice reconnect-ws-takeover: תרגום נקודתי להודעת "נפתח במקום אחר" ───
// ה-VM לרוב לא מייבא t() (i18n שייך לשכבת-הרכיב — ר' #appendUserPlaceholder), אבל
// `error` הוא string גולמי שמוצג as-is (routes/+page.svelte:191, לא עובר t() ברכיב) —
// כמו הודעות "WS closed (...)" הקיימות. חייב לעבור דרך core/i18n (לא Hebrew ליטרלי
// בקוד — lint:i18n אוכף), ולא להשתמש ב-I18nVM (לא מוזרק ל-VM הזה).
import { DEFAULT_CLAUDE_SESSION_META } from "@drive-coding/core"
import { createI18n, detectLocale } from "@drive-coding/core/i18n"
import {
  type AcpClient,
  createAcpClient,
  // ─── slice-image-paste Commit 4a/4b: טיפוס blocks לשליחה מולטימודלית ───
  type PromptBlocks,
} from "@drive-coding/provider/client"
import {
  createAgent,
  deleteAgent,
  notifySessionAttached,
  patchAgent,
  releaseConnection,
} from "$lib/adapters/agents-api"
// ─── slice sessions-inline: normalize ───
import { normalizeSessionInfo, type SessionInfo } from "$lib/adapters/sessions"
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
import type { AgentInput, Connection } from "$lib/session/connection"
import { type FrameInput, toPatches } from "$lib/session/frame-router"
import { HttpConnection } from "$lib/session/http-connection"
// ─── slice local-view-wiring: LocalSessionView + tee ───
import { LocalSessionView } from "$lib/session/local-session-view"
// ─── slice session-view-port C3: SessionView DI ───
import type { SessionView, ViewEmission, ViewFrame } from "$lib/session/session-view"
import { findResetPatch, recoveringObserver } from "$lib/session/session-view-projection"
import { teeAcpCallbacks } from "$lib/session/tee-acp-callbacks"
import { WsConnection } from "$lib/session/ws-connection"
import { runColdReconnect } from "$lib/session/ws-reconnect-controller"
import type { Bubble, ToolCall, UserBubble } from "$lib/types/bubble"
// ─── slice-elicitation-ui: טיפוסי שאלה מובנת (view-model layer, נגזרים מ-SDK) ───
import type { ElicitationParams, ElicitationResponse } from "$lib/types/elicitation"
// ─── slice-permission-ui-basic: טיפוסי בקשת-הרשאה (view-model layer, נגזרים מ-SDK) ───
import type { PermissionParams, PermissionResponse } from "$lib/types/permission"
import { connInfo, connWarn } from "$lib/util/conn-log"
import { isBypassMode } from "$lib/util/permission-mode"
import { safeUUID } from "$lib/util/uuid"
import {
  type ApplyConfigOptionDeps,
  type ApplyConfigToClientDeps,
  applyConfigOption as applyConfigOptionExtracted,
} from "$lib/view-models/agent-session-apply-config"
import {
  type CaptureSessionConfigDeps,
  captureSessionConfig,
} from "$lib/view-models/agent-session-capture-config"
import { isValidChoice } from "$lib/view-models/agent-session-config-choice"
import {
  type DeleteSessionDeps,
  deleteSession as deleteSessionExtracted,
} from "$lib/view-models/agent-session-delete"
import {
  sendDetachFrame,
  type TransportTestStub,
} from "$lib/view-models/agent-session-detach-frame"
import { type LoadMockSessionDeps, loadMockSession } from "$lib/view-models/agent-session-load-mock"
// ─── slice surface-real-error: עדיפות data.details→data.message→message→String(e) ───
import {
  applyManualTitleFromAttach,
  applyTitleFromSessionInput,
  type ManualTitleInput,
  setManualTitleOnAgent,
  syncTitleFromViewState,
} from "$lib/view-models/agent-session-manual-title"
import { doRefreshQuota, type QuotaRefreshDeps } from "$lib/view-models/agent-session-quota-refresh"
import {
  onRequestPermission as onRequestPermissionExtracted,
  type RequestPermissionDeps,
} from "$lib/view-models/agent-session-request-permission"
import {
  endSessionScope,
  registerSessionEndListener,
  type SessionEndReason,
  type SessionEndScopeDeps,
} from "$lib/view-models/agent-session-session-end"
import { formatAcpError } from "$lib/view-models/format-acp-error"
import { SessionScope } from "$lib/view-models/session-scoped-state.svelte"
import { SessionsCacheScope } from "$lib/view-models/sessions-cache-scope.svelte"
import type { Settings } from "$lib/view-models/settings.svelte"
import {
  handleSubagentToolCall,
  handleSubagentToolCallUpdate,
  type SubagentToolNestingDeps,
} from "$lib/view-models/subagent-tool-nesting"

export type { SessionEndReason } from "$lib/view-models/agent-session-session-end"

// ─── image-attach kill-switch ─── (slice-image-paste Commit 2)
// Commit 4b הפך ל-true — שליחה מולטימודלית פעילה.
// supportsImageInput קורא raw #client.capabilities.promptCapabilities.image
// (§10 הכרעה א — raw, לא NormalizedCapabilities).
const IMAGE_INPUT_ENABLED = true

// ─── slice plan-todo-list Commit 1: reducer טהור + טיפוסים ─── (additive)
import { type PlanStore, reducePlan } from "@drive-coding/core/acp/plan"
// ─── slice session-state-reducer C4: reduce + types ─── (additive)
import {
  createInitialSessionState,
  type Patch,
  type SessionState,
} from "@drive-coding/core/session"
// ─── slice session-budget-meter Commit 4: QuotaSnapshot טיפוס בלבד ─── (additive)
import type { QuotaSnapshot } from "@drive-coding/provider/extensions"
// ─── slice FE-normalization: ייבוא ─── (additive)
// import type בלבד — NormalizedCapabilities מ-subpath ./types (pure, ללא spawn-core).
// ⚠️ אל תייבא value מ-@drive-coding/provider/host → יגרור spawn-core → vite crash.
import type { NormalizedCapabilities } from "@drive-coding/provider/types"
import { createExtClient, type ExtClient } from "$lib/adapters/ext"
// ─── slice session-state-reducer C4: FE patch applicator + mappers ─── (additive)
// ─── slice subagent-transcript-data-v2: פרסר+reducer טהורים (additive) ───
import {
  type ClaudeSubagentEvent,
  createSubagentIndex,
  parseClaudeSdkMessage,
} from "./claude-subagent-parse"
import { type HistoryMark, historyMarkFromReset } from "./history-mark.js"
import { watchPageVisibility } from "./page-visibility.js"
import { TranscriptScope } from "./transcript-scope.svelte"

/**
 * _meta שמוזרק ל-session/new+load של claude בלבד — מחזיר thinking summaries
 * ומבקש raw SDK frames ל-spike של subagent transcript.
 * Opus 4.7+ שינה default ל-display:"omitted"; זה מבקש "summarized" מפורשות.
 * provider-agnostic: ה-key claudeCode מתעלם ע"י ספקים אחרים.
 */
/** Local FE path only — config file does not affect this (brief session-meta-config §4.6). */
const CLAUDE_SESSION_META = DEFAULT_CLAUDE_SESSION_META

// ─── slice subagent-tool-nesting: helper טהור לחילוץ parentToolUseId ───
/**
 * מחלץ `parentToolUseId` מ-`_meta.claudeCode` של frame גולמי של `session/update`.
 * `rawUpdate` הוא `notification.update` הגולמי, לפני יישום הפקודות ב-`#onSessionUpdate`.
 * `_meta` אינו חלק מטיפוסי ה-SDK הסגורים, ולכן קוראים אותו אחרי narrowing מבני בטוח,
 * בלי `as SDKMessage`. brief §3/§4 (אביגיל #2).
 */
function extractParentToolUseId(rawUpdate: unknown): string | undefined {
  if (typeof rawUpdate !== "object" || rawUpdate === null) return undefined
  const meta = (rawUpdate as { _meta?: unknown })._meta
  if (typeof meta !== "object" || meta === null) return undefined
  const claudeCode = (meta as { claudeCode?: unknown }).claudeCode
  if (typeof claudeCode !== "object" || claudeCode === null) return undefined
  const parentToolUseId = (claudeCode as { parentToolUseId?: unknown }).parentToolUseId
  return typeof parentToolUseId === "string" ? parentToolUseId : undefined
}

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
  /** Selected transport owner for the current entry; closing moves here in B4. */
  #connection: Connection | null = null
  /**
   * slice local-view-wiring C3: ה-view המקומי, מטופס. `#view` מחזיק **את אותו אובייקט**
   * (בשביל `#cleanup`), אבל רק דרך השדה הזה קוראים ל-dispose/adopt/observerCallbacks —
   * `session-view.ts:94` (החוזה) מכריז close() בלבד, והטיפוס שלו שולל dispose.
   * ⚠️ לא `as LocalSessionView` על `#view` — הוא ישקר בשקט אם view של remote יגיע לשם.
   */
  #localView: LocalSessionView | null = null
  #viewReader: ReadableStreamDefaultReader<ViewEmission> | null = null
  /**
   * slice local-view-wiring C1: ה-view **כמתג-מצב**. `#view !== null` נשא נטל כפול —
   * "יש אובייקט" **וגם** "אנחנו ב-remote". 15 אתרים קראו אותו כמתג. עכשיו המתג הוא
   * `#isRemote`, וה-view נשמר ל-lifecycle/זהות בלבד. מוצב true במקומות שבהם הוצב
   * view של remote (constructor עם opts.view · attachRemote · attachRemoteToLiveAgent),
   * ומתאפס ב-#cleanup. המסלול המקומי (C3) אינו עובר בקונסטרוקטור — #isRemote נשאר false.
   */
  #isRemote = false

  /** ה-view **כמתג-מצב**: לא-null אך ורק ב-remote. השוואת `#view` ישירות = באג. */
  #remoteView(): SessionView | null {
    return this.#isRemote ? this.#view : null
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
      this.#isRemote = !(opts.view instanceof LocalSessionView)
      void this.#consumeViewPatches(opts.view)
    }
    // ─── slice ws-reconnect-infra: visibility tracking (עבר ל-#visibility) ───
    if (typeof document !== "undefined") {
      // watchdog §2 — רק בדפדפן. בטסטים/SSR אין טיימר רקע שידלוף.
      this.#startStallWatch()
    }
  }

  // ─── state ─── (פולשני לעריכה — תאם מול Tama)
  status = $state<AgentSessionStatus>("idle")
  /** מה המודל עושה בתור הנוכחי. idle = אין תור פעיל. */
  turnState = $state<TurnState>("idle")
  error = $state<string | null>(null)
  // ─── slice auth-guidance: authMethods שנלכדו מ-initialize (client.authMethods) ───
  /** [] = אין כשל-auth ידוע / warm-reattach (מדלג initialize) / CLI לא מפרסם authMethods. */
  authMethods = $state<ReadonlyArray<AuthMethod>>([])
  #transcript = $state(new TranscriptScope(null))
  get bubbles(): Bubble[] {
    return this.#transcript.bubbles
  }
  set bubbles(value: Bubble[]) {
    this.#transcript.replace(value)
  }
  // ─── slice session-state-reducer C4: מצב SessionState פנימי (base ל-reduce) ─── (additive)
  sessionState = $state<SessionState>(createInitialSessionState({ sessionId: null }))
  // ─── slice reconnect-bubble-merge: frozen display בזמן warm-reconnect replay ───
  /** לא-null רק בזמן replay של חיבור מחדש — מקפיא את התצוגה על הרשימה הישנה. */
  agentId = $state<string | null>(null)
  cwd = $state<string | null>(null)
  // ─── slice ws-reconnect-infra: reconnect state ─── (INVASIVE — מאושר)
  /** 0 = לא מנסה reconnect; >0 = ניסיון נוכחי (1-indexed לחיווי UI). */
  reconnectAttempt = $state<number>(0)
  // ─── slice 4: replay guard + narration context ─── (תוספתי)
  /** True בזמן ש-loadSession() מנגן היסטוריה מחדש. ה-Speaker קורא את זה (תחת מעקב) כדי להשתיק TTS. */
  isLoadingHistory = $state(false)
  /**
   * historyEpoch — נשאר בגרעין בכוונה: מונה מונוטוני של חתכי היסטוריה.
   * עולה פעם אחת ב-hydration של view חדש. אין לאפס אותו בפירוק או בחיבור מחדש:
   * Speaker מדלג על epoch שכבר ראה.
   */
  historyEpoch = $state(0)
  /**
   * #historyMark נשאר בגרעין לצד historyEpoch. החתך אינו ריאקטיבי בכוונה;
   * Speaker קורא אותו רק כשהמונה משתנה.
   */
  #historyMark: HistoryMark = { segmentCounts: new Map(), toolCallIds: [] }
  get historyMark(): HistoryMark {
    return this.#historyMark
  }
  /** טקסט הפרומפט האחרון שנשלח על ידי המשתמש — משמש את ה-Speaker להקשר עבור קריינות. */
  lastUserMessage = $state("")

  // ─── slice-permission-ui-basic: בקשת הרשאה חיה (agent→client, ממתינה לתשובה) ───
  /**
   * בקשת הרשאה ממתינה מהסוכן — pending יחיד (בקשה שנייה סוגרת את הקודמת כ-cancelled).
   * null = אין בקשה פעילה. ה-UI (PermissionRequestBlock) מרנדר inline כשזה לא-null.
   * `resolve` הוא ה-resolver של ה-Promise שהוחזר ל-`createClientImpl.requestPermission` —
   * חובה לפתור אותו בכל נקודה ש-#client מתאפס, אחרת ה-turn נתקע (§4 Commit 2, הסיכון #1).
   * ─── slice view-switch C3-ו: requestId אופציונלי ─── (additive)
   * remote תמיד מציב אותו (guard-זהות מול patch מעופש); הנתיב המקומי בונה בלי requestId
   * (#onRequestPermission) — שדה-חובה היה שובר typecheck שם, בניגוד ל"אפס שינוי ב-local".
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
   * `resolve` הוא ה-resolver של ה-Promise שהוחזר ל-`createClientImpl.createElicitation`
   * — חובה לפתור אותו בכל נקודה ש-#client מתאפס, אחרת ה-turn נתקע (מחקה pendingPermission —
   * הסיכון #1 יורש מ-A1). ר' docs/plans/slice-elicitation-ui.md §4 Commit 2.
   * ─── slice view-switch C3-ו: requestId אופציונלי ─── (additive, מקביל ל-pendingPermission)
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
    this.#session.setManualTitle(v, this.#session.titleManual)
  }
  get titleManual(): boolean {
    return this.#session.titleManual
  }
  set titleManual(v: boolean) {
    this.#session.setTitleManual(v)
  }
  get userNotes(): string {
    return this.#session.userNotes
  }
  set userNotes(v: string) {
    this.#session.setUserNotes(v)
  }
  get sessionFields(): Record<string, string> {
    return this.#session.sessionFields
  }
  set sessionFields(v: Record<string, string>) {
    this.#session.setSessionFields(v)
  }
  get availableCommands(): AvailableCommand[] {
    return this.#session.availableCommands
  }
  set availableCommands(v: AvailableCommand[]) {
    this.#session.applyPatch({ kind: "commands", commands: v })
  }
  get planStore(): PlanStore {
    return this.#session.planStore
  }
  set planStore(v: PlanStore) {
    this.#session.applyPatch({ kind: "plan", plan: v })
  }
  get contextUsage(): UsageUpdate | null {
    return this.#session.contextUsage
  }
  set contextUsage(v: UsageUpdate | null) {
    this.#session.applyPatch({ kind: "usage", usage: v })
  }
  get quota(): QuotaSnapshot | null {
    return this.#session.quota
  }
  set quota(v: QuotaSnapshot | null) {
    this.#session.applyPatch({ kind: "quota", quota: v })
  }
  get quotaLoading(): boolean {
    return this.#session.quotaLoading
  }
  set quotaLoading(v: boolean) {
    this.#session.applyPatch({ kind: "quota-loading", loading: v })
  }

  // ─── slice reconnect-bubble-merge: render-consumers (additive) ───
  /** רשימת התצוגה. בזמן warm-reconnect replay מוקפאת ל-snapshot; אחרת = live bubbles. */
  get renderBubbles(): Bubble[] {
    return this.#transcript.renderBubbles
  }

  /** true רק בזמן warm-reconnect replay (התצוגה קפואה). לא נדלק בטעינה ראשונית/switchSession. */
  get isReconnectReplay(): boolean {
    return this.#transcript.isReconnectReplay
  }

  annotateToolNarration(bubbleId: string, text: string): void {
    this.#transcript.annotateNarration(bubbleId, text)
  }

  annotateThoughtTranslation(
    bubbleId: string,
    index: number,
    original: string,
    translated: string,
  ): boolean {
    return this.#transcript.annotateTranslation(bubbleId, index, original, translated)
  }

  // ─── image-attach: capability gating ─── (slice-image-paste, additive)
  /**
   * האם הסשן הנוכחי תומך בקלט תמונה.
   * IMAGE_INPUT_ENABLED=false → תמיד false (פיגום רדום).
   * מקור כפול (slice reattach-state-sync): raw `#client` caps (cold connect, מ-`initialize`)
   * **או** ה-NormalizedCapabilities מ-`_drive/capabilities` (`#capabilities.image`) — שנדחף בכל
   * attach ולכן **שורד warm reattach** (שבו `#client` נוצר עם `ATTACHED_CAPS_FALLBACK` ריק).
   */
  get supportsImageInput(): boolean {
    return (
      IMAGE_INPUT_ENABLED &&
      (this.#client?.capabilities?.promptCapabilities?.image === true ||
        this.#capabilities?.image === true)
    )
  }

  // ─── slice session-delete: capability gating ─── (additive)
  /**
   * האם הסוכן מכריז `sessionCapabilities.delete` — raw ACP caps (`#client.capabilities`),
   * **לא** NormalizedCapabilities (capability סטנדרטי של הפרוטוקול, אחיד בין ספקים —
   * הנרמול שמור לחוץ-פרוטוקוליים בלבד. החלטת המשתמשת 2026-07-20).
   * ⚠️ warm-reattach: אין initialize טרי → `#client` נוצר עם `ATTACHED_CAPS_FALLBACK` ריק →
   * false עד connect קר חדש. מקובל ל-MVP (עקבי עם המגבלה הידועה של `supportsImageInput`).
   *
   * slice remote-session-mgmt C5: ב-remote המקור הוא ה-view (sessionCapabilities
   * מתשובת listSessions — false עד התשובה הראשונה).
   */
  get supportsSessionDelete(): boolean {
    const view = this.#remoteView()
    return view
      ? view.supportsSessionDelete
      : this.#client?.capabilities?.sessionCapabilities?.delete != null
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

  /**
   * ExtClient facade — גישה לשליחת _drive/* ext requests.
   * null = אין חיבור פעיל. ה-vm קורא לzה דרך שיטות ציבוריות (לא ישירות).
   */
  get ext(): ExtClient | null {
    return this.#ext
  }

  // ─── slice sessions-cache-scope: connection-scoped session list ───
  sessionsCache = $state(new SessionsCacheScope())

  // ─── slice drop-a5-watchdog (25/08): `slice-A5-watchdog` הוסר ───
  // היה טיימר של 45ש' שכפה `idle` והדליק `turnInterrupted`. נמחק, לא כוונן:
  // ה-kick היחיד שלו ישב ב-`#onSessionUpdate`. לפני frame-ingest-unify הגיעו
  // ב-HTTP רק patches מסוג `opaque`; עכשיו כל session/update חוצה את אותו hook.
  // זיהוי תור-ששקע חי ב-`engines/turn-watchdog.ts` — מתריע, **אינו קוטע**,
  // ומתאפס בשני המסלולים (`#noteAgentActivity`).

  // ─── msr-v2: מעקף opencode #17505 (tail-debounce) ───
  // opencode מחזיר RESP של session/prompt באמצע הזרם — ≈חצי התשובה (tail עד ~5.6ש')
  // מגיעה אחרי ה-RESP, ודורסת turnState ל-responding אחרי שכבר נקבע idle.
  // מפר את ה-ACP spec (כל notifications לפני response). gemini/claude תקינים →
  // ה-net הזה לא מופעל אצלם. כשהבאג ייסגר אפשר להסיר #turnEnded/#scheduleIdle/#TAIL_MS.
  #turnEnded = false // דלוק בין RESP לתחילת תור הבא
  #idleTimer: ReturnType<typeof setTimeout> | null = null // | null כמו settings.svelte.ts
  #TAIL_MS = 1500 // debounce לבליעת tail (אחרי RESP בלבד)

  /** מתזמן idle אחרי שקט מ-tail. נקרא רק כש-#turnEnded דלוק. כל tail-chunk מאפס. */
  #scheduleIdle(): void {
    if (this.#idleTimer !== null) clearTimeout(this.#idleTimer)
    this.#idleTimer = setTimeout(() => {
      this.#idleTimer = null
      this.#setTurnState("idle")
    }, this.#TAIL_MS)
  }

  /** מאפס את מעקב-התור. חובה בתחילת תור (sendPrompt) ובכל טעינה (replay אינו תור). */
  #resetTurnTracking(): void {
    this.#turnEnded = false
    if (this.#idleTimer !== null) {
      clearTimeout(this.#idleTimer)
      this.#idleTimer = null
    }
  }

  // ─── slice drop-a5-watchdog: `#kickWatchdog`/`#clearWatchdog` נמחקו ───

  #client: AcpClient | null = null
  // ─── slice FE-normalization: ext facade ─── (additive)
  /** facade מטופס לשליחת _drive/* ext requests. נוצר/מנוקה עם #client. */
  #ext: ExtClient | null = null
  // ─── slice FE-normalization: capabilities ─── (additive)
  /** NormalizedCapabilities שהתקבלו מ-_drive/capabilities ext notification. null = טרם התקבל. */
  #capabilities: NormalizedCapabilities | null = null
  // ─── slice session-budget-meter Commit 4: mock quota harness (DEV-only) ─── (additive)
  /**
   * snapshot מדומה ל-mock harness בלבד (`/chat?mock=<fixture>` עם `mockState.quota`).
   * undefined = לא הוזרק ע"י fixture (ברירת המחדל). null = הוזרק במפורש כ"אין מגבלות".
   * `refreshQuota()` מעתיק את זה ל-`quota` הציבורי רק כש-sessionId מתחיל "mock:" וגם
   * הערך `!== undefined` — כדי ש-open→refresh→render יעבור דרך אותה מתודה כמו production.
   * מתאפס ב-#cleanup ו-#captureSessionConfig (brief §0 "התאמת scope").
   */
  #mockQuota: QuotaSnapshot | null | undefined = undefined
  /** Promise פעיל של refreshQuota — dedupe לפתיחות popover מקבילות (brief §4 Commit 4). */
  #quotaFetchInFlight: Promise<void> | null = null
  /** Counter פנימי ל-spike raw SDK. לא נרנדר ב-UI. */
  #claudeRawSdkMessageCount = 0
  // ─── slice subagent-transcript-data-v2: תעתיק תת-סוכן (additive) ───
  /** taskId→toolUseId, נבנה מ-task_started (Q3). */
  #subagentIndex = createSubagentIndex()
  /** אירועים שהגיעו לפני שה-Task ToolBubble נוצר ב-bubbles (bounded — §7 Risks). */
  #pendingByParent: { parentId: string; event: ClaudeSubagentEvent }[] = []
  static readonly #SUBAGENT_PENDING_CAP = 50
  /** slice connection-set C2: one id per VM lifetime — SSE header, presence, WS query, DELETE. */
  readonly #connectionId = safeUUID()
  #pageHideReleaseBound = false
  #sessionId: string | null = null

  /**
   * Session-identity boundary. A new scope is born only when the incoming identity differs
   * from the one the current scope was born for (compare `#session.sessionId`, not `#sessionId`).
   */
  #enterSession(id: string | null): void {
    if (this.#session.sessionId !== id) {
      const initialBubbles = this.#session.sessionId === null ? this.#transcript.bubbles : []
      this.#session = new SessionScope(id)
      this.#transcript = new TranscriptScope(id)
      if (initialBubbles.length > 0) this.#transcript.replace(initialBubbles)
    }
    this.#sessionId = id
  }

  #subagentToolNestingDeps(patches: Patch[] = []): SubagentToolNestingDeps {
    return {
      bubbles: () => this.bubbles,
      appendNestedTool: (parentId, child) => this.#transcript.appendNestedTool(parentId, child),
      updateNestedTool: (parentId, childId, update) =>
        this.#transcript.updateNestedTool(parentId, childId, update),
      getParent: (id) => this.#session.getSubagentParent(id),
      registerParent: (id, parentId) => this.#session.registerSubagentParent(id, parentId),
      turnEnded: () => this.#turnEnded,
      applyToolCall: (update) => this.#applyToolCall(update, patches),
      setTurnState: (next) => this.#setTurnState(next),
      scheduleIdle: () => this.#scheduleIdle(),
    }
  }

  #sessionEndScopeDeps(): SessionEndScopeDeps {
    return { sessionEndListeners: () => this.#sessionEndListeners }
  }

  #requestPermissionDeps(): RequestPermissionDeps {
    return {
      pendingPermission: () => this.pendingPermission,
      setPendingPermission: (v) => {
        this.pendingPermission = v
      },
      bypassActive: () => this.bypassActive,
      resolvePendingPermission: (response) => this.#resolvePendingPermission(response),
    }
  }

  #applyConfigToClientDeps(): ApplyConfigToClientDeps {
    return {
      configOptions: () => this.configOptions,
      setConfigOptions: (v) => {
        this.configOptions = v
      },
      client: () => this.#client,
      sessionId: () => this.#sessionId,
      models: () => this.models,
      setModels: (v) => {
        this.models = v
      },
      modes: () => this.modes,
      setModes: (v) => {
        this.modes = v
      },
    }
  }

  #applyConfigOptionDeps(): ApplyConfigOptionDeps {
    return {
      ...this.#applyConfigToClientDeps(),
      status: () => this.status,
      remoteView: () => this.#remoteView(),
      cliKind: () => this.#cliKind,
      settings: () => this.#settings,
    }
  }

  #quotaRefreshDeps(): QuotaRefreshDeps {
    return {
      sessionId: () => this.#sessionId,
      mockQuota: () => this.#mockQuota,
      ext: () => this.#ext,
      setQuota: (v) => {
        this.#session.applyPatch({ kind: "quota", quota: v })
      },
      setQuotaLoading: (v) => {
        this.#session.applyPatch({ kind: "quota-loading", loading: v })
      },
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
        this.#session.applyPatch({ kind: "commands", commands: v })
      },
      setContextUsage: (v) => {
        this.#session.applyPatch({ kind: "usage", usage: v })
      },
      setQuota: (v) => {
        this.#session.applyPatch({ kind: "quota", quota: v })
      },
      setQuotaLoading: (v) => {
        this.#session.applyPatch({ kind: "quota-loading", loading: v })
      },
      setMockQuota: (v) => {
        this.#mockQuota = v
      },
      session: () => this.#session,
      setPlanStore: (v) => {
        this.#session.applyPatch({ kind: "plan", plan: v })
      },
    }
  }

  #deleteSessionDeps(): DeleteSessionDeps {
    return {
      remoteView: () => this.#remoteView(),
      client: () => this.#client,
      sessionId: () => this.#sessionId,
      cache: () => this.sessionsCache,
      detachWith: (reason) => this.#detachWith(reason),
    }
  }
  /**
   * הערך הוא True בין detach() ל-attach() הבא. משתיק
   * שגיאות `WS closed (1005)` מזויפות מאירועי onClose שמופעלים לאחר שהמשתמש
   * התנתק באופן מפורש.
   */
  #detached = false
  /**
   * True בזמן סגירת WS מכוונת. מונע מה-onClose הישן
   * (שמקבל 1005 מ-#client.close()) להצית לולאת reconnect שנייה (NBug2).
   * שונה מ-#detached: detach=סיום סופי; tearingDown=מעבר זמני בתוך cold.
   */
  #tearingDown = false
  /**
   * True רק אחרי catch **טרמינלי** (attach/loadSession — שם #cleanup רץ / ה-agent מת).
   * anti-clobber guard ב-#handleUnexpectedClose (calev-heavy §10.2, Commit 4): במקור
   * ה-guard היה `status==="error"`, אבל switchSession/newSession גם קובעים status="error"
   * ומשאירים את ה-WS חי (בלי #cleanup) — כשל שם לא אמור להשתיק reconnect אם ה-WS נופל
   * מאוחר יותר. הדגל מוצת רק בכשל טרמינלי, ומתאפס בתחילת כל מתודת-חיבור (attach/
   * loadSession/switchSession/newSession/attachToLiveAgent) כדי שסשן חדש לא ייתקע.
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
  /** slice reconnect-on-visible: רקע/פוקוס. חזרה לפוקוס מחמשת reconnect חולף בלבד
   * (error!==null = טרמינלי: takeover / session-host-active. חימוש שם = ping-pong). */
  #visibility = watchPageVisibility(() => {
    if (this.status === "disconnected" && this.error === null) {
      if (this.#connection instanceof WsConnection)
        void this.#connection.onUnexpectedClose(1006, "visible")
    }
  })

  // ─── slice session-view-port C3: SessionView patch consumer ───

  /**
   * קורא מ-view.patches ומעדכן bubbles + metadata ב-VM.
   * רץ ברקע (אסינכרוני) ב-loop אינסופיני עד שה-stream נסגר.
   * כל batch patches: עדכון bubbles ביעד (applyPatchMutable) + סינכון metadata.
   */
  async #consumeViewPatches(view: SessionView): Promise<void> {
    this.#cancelViewReader()
    const reader = view.patches.getReader()
    this.#viewReader = reader
    // ─── slice empty-session-sync ───
    // סנכרון ראשוני מה-snapshot, **לפני** הלולאה.
    // הסנכרון שבתוך הלולאה מותנה ב-patches, וסשן **חדש** הוא ריק: אין הודעות,
    // ולכן אין reset patch, ולכן `continue` — ו-#syncFromViewState לא נקרא לעולם.
    // התוצאה למשתמשת: אין מוד, אין מודל (configOptions), ואין כפתור תמונה
    // (capabilities) — עד שנטענת היסטוריה שמייצרת patches.
    // ⚠️ זה חייב לרוץ גם כש-view.state ריק — הוא נושא את המטא-דאטה בלי קשר
    // למספר ההודעות.
    if (this.#isRemote) this.#syncFromViewState(view.state)
    let attachWindow = true
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        // ─── slice view-switch C3-א.6: כמת בזהות, לא בנוכחות ───
        // אחרי attachRemote חדש (שקורא #cleanup על ה-view הישן), לולאת ה-drain של ה-view
        // הישן עדיין יכולה למסור batch — guard שבודק רק this.#view !== null היה מעביר
        // אותו אל ה-VM החדש. אותו כלל בדיוק כמו ב-shim (#syncPendingPermission/Elicitation).
        if (this.#view !== view) break
        const emission = value
        if (!emission?.frames || emission.sessionToken !== view.sessionToken) continue
        for (const frame of emission.frames) {
          if (this.#view !== view || emission.sessionToken !== view.sessionToken) break
          const reset = findResetPatch(frame.corePatches)
          if (reset) {
            this.#transcript.applyPatch({ kind: "frame", patches: [reset] })
            this.sessionState = frame.state
            if (attachWindow) {
              attachWindow = false
              this.#historyMark = historyMarkFromReset(reset.messages)
              this.historyEpoch++
            }
          } else {
            this.sessionState = frame.state
            this.#onSessionUpdate({ update: frame.rawUpdate }, frame)
          }
          if (this.#isRemote) this.#syncFromViewState(frame.state)
        }
      }
    } catch {
      // stream נסגר או בוטל — תקין
    } finally {
      if (this.#viewReader === reader) this.#viewReader = null
      try {
        reader.releaseLock()
      } catch {
        /* */
      }
    }
  }

  #cancelViewReader(): void {
    if (this.#viewReader) void this.#viewReader.cancel().catch(() => {})
    this.#viewReader = null
  }

  // ─── slice local-view-wiring C3: קשירה ואימוץ מקומיים (brief §4.3-§4.5) ───

  /**
   * שלב א' — **לפני** יצירת הלקוח (ה-callbacks קופאים ביצירתו — §2.5): משחרר את
   * הקודם (`#localView.dispose()`, לא close — הלקוח משותף), בונה view חדש, **מציב
   * אותו ב-#localView וב-#view מיד** (סוגר את חלון-היתום של attach/loadSession
   * שנכשלים אחריו — §4.5), מפעיל את צרכן ה-frames היחיד ומחזיר אותו ל-tee.
   */
  #bindLocalView(initialSessionId?: string): LocalSessionView {
    this.#cancelViewReader()
    this.#localView?.dispose()
    const view = new LocalSessionView({
      cwd: this.cwd ?? "",
      cliKind: this.#cliKind ?? "",
      initialSessionId,
    })
    this.#localView = view
    this.#view = view
    void this.#consumeViewPatches(view)
    return view
  }

  #callbacksForLocalView(view: LocalSessionView): Parameters<typeof createAcpClient>[1] {
    return teeAcpCallbacks(
      {
        onUpdate: this.#onSessionUpdate,
        onExtNotification: this.#onExtNotification,
        onRequestPermission: this.#onRequestPermission,
        onCreateElicitation: this.#onCreateElicitation,
      },
      recoveringObserver(view, view.observerCallbacks),
    )
  }

  #cancelPendingDialogs(): void {
    this.#resolvePendingPermission({ outcome: { outcome: "cancelled" } })
    this.#resolvePendingElicitation({ action: "cancel" })
  }

  /**
   * שלב ב' — **אחרי** יצירת הלקוח, **לפני** כל קריאה שמזרימה היסטוריה (§4.4):
   * מאמץ את הלקוח אל ה-view (מאפס את state ה-view לסשן החדש). נקודות 4/5
   * (switchSession/newSession מקומיים) קוראות לו עם אותו לקוח — בלי dispose ובלי
   * בנייה מחדש (ה-tee קפוא על ה-view שנוצר ביצירת הלקוח — §4.3).
   */
  #adoptLocalView(client: AcpClient, sessionId: string): void {
    this.#localView?.adopt({ client, sessionId })
  }

  /**
   * מסנכן שדות metadata מ-SessionState (ישיר) לשדות ה-$state של ה-VM.
   * נקרא אחרי כל batch patches מ-view.patches.
   */
  #syncFromViewState(viewState: SessionState): void {
    // ─── slice view-switch C3-ו: view נלכד פעם אחת — משמש את ה-shim של pending למטה ───
    const view = this.#view
    if (!view) return
    this.#noteAgentActivity() // watchdog §2 — מסלול HTTP (batch patches)
    // turnState (נגזר מסוג patch ב-reduce) — ✅ ללא תנאי, ה-BE הוא הסמכות (isSpuriousIdle בוטל)
    const vt = viewState.turnState as TurnState
    if (vt !== this.turnState) this.#setTurnState(vt)
    syncTitleFromViewState(this.#session, viewState.title)
    // contextUsage (אופציונלי — אפסר לאמץ ל-UsageUpdate סטרקטורלית)
    if (viewState.contextUsage !== this.contextUsage) {
      this.#session.applyPatch({
        kind: "usage",
        usage: viewState.contextUsage as typeof this.contextUsage,
      })
    }
    // commands
    this.#session.applyPatch({
      kind: "commands",
      commands: viewState.commands as typeof this.availableCommands,
    })
    // modes
    this.modes = viewState.modes as typeof this.modes
    // configOptions
    this.configOptions = viewState.configOptions as typeof this.configOptions
    // quota
    if (viewState.quota !== this.quota)
      this.#session.applyPatch({ kind: "quota", quota: viewState.quota })
    // ─── slice http-usable C1: capabilities from SessionState → #capabilities ───
    // In remote there is no #client, and _drive/capabilities is only sent by
    // ws-agent — so supportsImageInput was always false over HTTP. The BE now
    // fills state.capabilities and the snapshot carries it; this is where it
    // lands in the VM. null = not received yet → never clobber an existing value.
    if (viewState.capabilities !== null && viewState.capabilities !== this.#capabilities) {
      this.#capabilities = viewState.capabilities as NormalizedCapabilities
    }

    // ─── slice view-switch C3-ו.1: pending (permission + elicitation) — guard-זהות ───
    this.#syncPendingPermission(viewState.pending.permission, view)
    this.#syncPendingElicitation(viewState.pending.elicitation, view)

    // ─── slice view-switch C3-ו.2: lastTurnError → session.error (דו-כיווני, ממוקד) ───
    if (viewState.lastTurnError) {
      this.error = `prompt failed: ${viewState.lastTurnError.message}`
      this.#errorFromTurn = this.error
    } else if (this.error !== null && this.error === this.#errorFromTurn) {
      // תור חדש מנקה **רק** באנר שמקורו כאן — אזהרה ממקור אחר (reply failed, כשל-שיגור)
      // שורדת (הצד השני של אותו מטבע: known-gap — שום דבר לא מנקה אזהרות כאלה, S6 לא סוגר).
      this.error = null
      this.#errorFromTurn = null
    }
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
            if (this.#tearingDown || this.#view !== view) return
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
            if (this.#tearingDown || this.#view !== view) return
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
  #remoteViewOpts(): { headers: Record<string, string>; onSseReconnected: () => void } {
    const headers = { "Acp-Connection-Id": this.#connectionId }
    return { headers, onSseReconnected: () => this._onSseReconnectedForTest() }
  }

  /**
   * @internal slice http-live-side-effects — המסלול האמיתי של onSseReconnected.
   * שגיאה חולפת (switchSession/newSession) נמחקת ב-reconnect; טרמינלית (#errorSurfaced) שורדת.
   */
  _onSseReconnectedForTest(): void {
    if (!this.#errorSurfaced) this.error = null
    this.#sseReconnectedListener?.()
  }

  #agentWsUrl(agentId: string): string {
    const proto = location.protocol === "https:" ? "wss:" : "ws:"
    const params = new URLSearchParams({ connectionId: this.#connectionId })
    return `${proto}//${location.host}/ws/agent/${agentId}?${params}`
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
  /** @internal */ _setReconnectAttemptForTest(n: number): void {
    this.reconnectAttempt = n
  }
  /** @internal */ _setTearingDownForTest(v: boolean): void {
    this.#tearingDown = v
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
   * @internal **predicate טהור** — מחזיר האם onClose עם ה-code הנתון *היה* מצית
   * reconnect, לפי אותה שרשרת gate כמו ה-handlers האמיתיים (#detached → #tearingDown
   * → 1000/1001). **אינו מריץ** את #handleUnexpectedClose/#scheduleReconnect — כדי
   * שהטסט לא יצית #runReconnectLoop עם setTimeout תלוי / async מודלף. הטסט בודק רק
   * את הערך המוחזר.
   * ⚠️ חובה לשמור מסונכרן עם שרשרת התנאים ב-2.ג (onClose handlers).
   */
  _wouldReconnectOnCloseForTest(code: number): boolean {
    if (this.#detached) return false
    if (this.#tearingDown) return false
    return code !== 1000 && code !== 1001
  }
  /**
   * @internal מזריק transport stub לבעל החיבור (לטסט closeAndWait לפני reconnect).
   * stub: אובייקט עם closeAndWait spy בלבד — לא WsAcpTransport אמיתי.
   */
  _setTransportForTest(t: TransportTestStub | null): void {
    if (t && !(this.#connection instanceof WsConnection)) this.#connection = this.#newWsConnection()
    if (t) (this.#connection as WsConnection).adoptTransport(t as WsAcpTransport)
  }
  /**
   * @internal מגדיר #sessionId + cwd + #cliKind ישירות — כדי ש-reconnect() לא יחזור מוקדם.
   */
  _setSessionContextForTest(ctx: { sessionId: string; cwd: string; cliKind: string }): void {
    this.#enterSession(ctx.sessionId)
    this.cwd = ctx.cwd
    this.#cliKind = ctx.cliKind
    if (!(this.#connection instanceof WsConnection)) this.#connection = this.#newWsConnection()
  }
  /**
   * @internal חושף #sessionId לטסטים (לבדיקת הזרקת state).
   */
  _getSessionIdForTest(): string | null {
    return this.#sessionId
  }
  /** @internal Identity assertion for TranscriptScope lifecycle tests. */
  _transcriptForTest(): TranscriptScope {
    return this.#transcript
  }
  /** @internal Checks owner identity across a failed cold replay. */
  _getConnectionForTest(): Connection | null {
    return this.#connection
  }
  /**
   * @internal קורא ישירות ל-#handleUnexpectedClose (slice surface-real-error Commit 1:
   * anti-clobber gate-test; Commit 3: הפך ל-async בגלל best-effort getAgent). מזמן
   * pageHidden=true (stub document ב-beforeEach) לפני construct — כדי שהענף
   * "disconnected" ירוץ ולא #scheduleReconnect (async מודלף).
   */
  _handleUnexpectedCloseForTest(code: number, reason: string): Promise<void> {
    return this.#handleUnexpectedClose(code, reason)
  }

  // ─── reconnect events ──────────────────────────────────────────────────

  async #handleUnexpectedClose(code: number, reason: string): Promise<void> {
    if (this.#errorSurfaced && this.error) return
    if (this.#connection instanceof WsConnection)
      await this.#connection.onUnexpectedClose(code, reason)
  }

  // ─── מחזור חיי חיבור (connection lifecycle) ─────────────────────────

  #newWsConnection(): WsConnection {
    const connection = new WsConnection({
      prepareNew: () => {
        this.#setStatus("connecting")
        this.error = null
        this.authMethods = []
        this.#errorSurfaced = false
        this.#transcript.replace([])
        this.#detached = false
      },
      setAgent: (agentId, cwd, cliKind) => {
        this.agentId = agentId
        this.cwd = cwd
        this.#cliKind = cliKind
      },
      url: (agentId) => this.#agentWsUrl(agentId),
      onClose: (code, reason) => {
        if (this.#connection !== connection || this.#detached || this.#tearingDown) return
        void this.#handleUnexpectedClose(code, reason)
      },
      bindLocalView: () => this.#bindLocalView(),
      callbacks: (view) => this.#callbacksForLocalView(view),
      setClient: (client) => {
        this.#client = client
        this.authMethods = client.authMethods
        this.#ext = createExtClient(client)
      },
      sessionMeta: () => this.#sessionMeta(),
      enterSession: (sessionId) => this.#enterSession(sessionId),
      adoptLocalView: (client, sessionId) => this.#adoptLocalView(client, sessionId),
      captureSessionConfig: (result) => this.#captureSessionConfig(result),
      connected: async () => {
        this.#setStatus("connected")
        await this.#applyRememberedConfig()
      },
      failed: (error) => {
        this.error = formatAcpError(error)
        this.#errorSurfaced = true
        this.#setStatus("error")
        this.#cleanup()
      },
      prepareExisting: (agent) => {
        this.error = null
        this.#errorSurfaced = false
        this.#detached = false
        this.#enterSession(agent.sessionId)
        this.agentId = agent.agentId
        this.cwd = agent.cwd
        this.#cliKind = agent.cliKind
        applyManualTitleFromAttach(this.#session, agent, true)
      },
      failedExisting: () => {
        this.error = "reconnect failed: agent no longer available"
        this.#setStatus("error")
      },
      reconnect: {
        context: () => {
          if (this.#sessionId === null || this.cwd === null || this.#cliKind === null) return null
          return {
            sessionId: this.#sessionId,
            cwd: this.cwd,
            cliKind: this.#cliKind,
            agentId: this.agentId,
            hidden: this.#visibility.hidden,
            detached: this.#detached,
            tearingDown: this.#tearingDown,
            remote: this.#isRemote,
            terminalError: this.#errorSurfaced && this.error !== null,
          }
        },
        snapshot: () => {
          this.#transcript.freezeDisplay()
        },
        setStatus: (status) => this.#setStatus(status),
        setAttempt: (attempt) => {
          this.reconnectAttempt = attempt
        },
        setTerminal: (kind, detail) => {
          if (kind === "crash") this.error = detail ?? null
          else {
            const t = createI18n({ locale: this.#settings?.locale ?? detectLocale() }).t
            this.error = t(
              kind === "takeover" ? "session.openedElsewhere" : "session.heldByOtherTransport",
            )
          }
          this.#setStatus("disconnected")
        },
        clearTransientError: () => {
          this.error = null
        },
        clearClient: () => {
          this.#client = null
          this.#ext = null
          this.#cancelPendingDialogs()
        },
        prepareWarm: () => {
          this.#detached = false
          this.#errorSurfaced = false
          this.#client = null
          this.#cancelPendingDialogs()
        },
        setWarmAgent: (agentId) => {
          this.agentId = agentId
        },
        setAttachedClient: (client) => {
          this.#client = client
          this.#ext = createExtClient(client)
        },
        startReplay: () => {
          this.#transcript.beginReplay()
          this.sessionState = createInitialSessionState({ sessionId: this.#sessionId })
          this.isLoadingHistory = true
        },
        finishReplay: () => {
          this.isLoadingHistory = false
          this.#setTurnState("idle")
        },
        disposeFailedWarm: () => {
          this.#client = null
          this.#ext = null
          this.#cancelPendingDialogs()
          this.#localView?.dispose()
          this.#localView = null
          this.#view = null
        },
        cold: (isCurrent) =>
          runColdReconnect(
            { sessionId: this.#sessionId, cwd: this.cwd, cliKind: this.#cliKind },
            isCurrent,
            {
              prepare: () => {
                try {
                  this.#client?.close()
                } catch {
                  // Already closed.
                }
                this.#client = null
                this.#ext = null
                this.#cancelPendingDialogs()
                if (this.status === "connecting" || this.status === "connected")
                  this.#setStatus("disconnected")
              },
              load: (input, onCreatedAgent) =>
                this.loadSession(input, {
                  preserveContextOnError: true,
                  isCurrent,
                  onCreatedAgent,
                }),
              connected: () => this.status === "connected",
            },
          ),
        connected: () => {
          this.error = null
          this.#errorSurfaced = false
          connInfo("reconnected", { agentId: this.agentId })
        },
      },
    })
    return connection
  }

  #newHttpConnection(): HttpConnection {
    return new HttpConnection({
      prepare: (agent) => {
        this.error = null
        this.authMethods = []
        this.#errorSurfaced = false
        this.#transcript.replace([])
        this.#detached = false
        this.#answeredPermissionId = null
        this.#answeredElicitationId = null
        this.#setStatus("connecting")
        this.cwd = agent.cwd
        this.#cliKind = agent.cliKind
      },
      setAgent: (agentId) => {
        this.agentId = agentId
      },
      viewOptions: () => this.#remoteViewOpts(),
      enterSession: (sessionId) => this.#enterSession(sessionId),
      bindView: (view) => {
        this.#view = view
        this.#isRemote = true
        void this.#consumeViewPatches(view)
      },
      applyTitle: (agent) => applyManualTitleFromAttach(this.#session, agent, false),
      connected: async () => this.#setStatus("connected"),
      rememberedConfig: () => this.#applyRememberedConfig(),
      failed: (error, keepAgent) => {
        this.#cleanup(keepAgent ? { keepAgent: true } : undefined)
        this.error = formatAcpError(error)
        this.#errorSurfaced = true
        this.#setStatus("error")
      },
      missingSessionId: (keepAgent) => {
        this.#cleanup(keepAgent ? { keepAgent: true } : undefined)
        this.error = "remote mode: backend did not provide a sessionId"
        this.#errorSurfaced = true
        this.#setStatus("error")
      },
    })
  }

  /** New local agent: WS transport and ACP are owned by WsConnection. */
  attach = async (input: Omit<Extract<AgentInput, { kind: "new" }>, "kind">): Promise<void> => {
    if (this.status === "connecting" || this.status === "connected") {
      throw new Error(`cannot attach in status ${this.status}`)
    }
    const connection = this.#newWsConnection()
    this.#connection = connection
    await connection.open({ ...input, kind: "new" })
  }

  /** New remote agent: HTTP/SSE only. */
  attachRemote = async (
    input: Omit<Extract<AgentInput, { kind: "new" }>, "kind">,
  ): Promise<void> => {
    if (this.status === "connecting" || this.status === "connected") {
      throw new Error(`cannot attach in status ${this.status}`)
    }
    this.#cleanup()
    const connection = this.#newHttpConnection()
    this.#connection = connection
    await connection.open({ ...input, kind: "new" })
  }

  /** Existing remote host: never creates an ACP WebSocket or a new agent. */
  attachRemoteToLiveAgent = async (
    input: { agentId: string; cwd: string; cliKind: string } & ManualTitleInput,
  ): Promise<void> => {
    if (this.status === "connecting" || this.status === "connected") {
      throw new Error(`cannot attach in status ${this.status}`)
    }
    this.#cleanup()
    const connection = this.#newHttpConnection()
    this.#connection = connection
    await connection.open({ ...input, kind: "existing-http" })
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
    this.#detached = true
    this.#connection?.cancelReconnect()
    this.reconnectAttempt = 0
    if (keepAgent && (this.pendingPermission || this.pendingElicitation)) {
      this.#cancelPendingDialogs()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    this.#cleanup(keepAgent ? { keepAgent: true } : undefined)
    this.#setStatus("idle")
    this.error = null
    this.#transcript.replace([])
    this.sessionsCache.reset()
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

  /** slice live-secretary — mirrors sendPrompt local-path guard inputs. */
  get isRemoteView(): boolean {
    return this.#isRemote
  }

  /** slice live-secretary — mirrors sendPrompt local-path guard inputs. */
  get hasAcpClient(): boolean {
    return this.#client !== null
  }

  // ─── slice-permission-ui-basic: בקשת הרשאה חיה ──────────────────────────────
  // תשתית גנרית ניתנת-לשכפול (callback + Promise round-trip) — slice B (elicitation)
  // ישכפל את הדפוס הזה ל-onCreateElicitation.

  /**
   * callback שמוזרק ל-createClientImpl.onRequestPermission (בשלושת ה-call-sites: attach,
   * loadSession, replay של חיבור מחדש). מוחזר Promise שנפתר כש-resolvePermission/cancelPermission
   * נקראים, או כש-#client מתאפס (כל נקודות ה-teardown — ר' #resolvePendingPermission).
   */
  #onRequestPermission = (params: PermissionParams): Promise<PermissionResponse> => {
    return onRequestPermissionExtracted(this.#requestPermissionDeps(), params)
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
   * ⚠️ **חובה** לקרוא מכל נקודה ש-#client מתאפס/הסשן נסגר, אחרת Promise דולף + turn תקוע
   * (הסיכון #1 של הסלייס): #cleanup (מכסה detach+leaveRunning), cancelTurn,
   * נתיבי reconnect דרך בעל החיבור.
   */
  #resolvePendingPermission(response: PermissionResponse): void {
    const pending = this.pendingPermission
    if (!pending) return
    pending.resolve(response)
    this.pendingPermission = null
  }

  // ─── slice-elicitation-ui: שאלה מובנת חיה ──────────────────────────────
  // מחקה 1:1 את בלוק בקשת ההרשאה שמעלה (client.ts השאיר עוגן מפורש לשכפול).

  /**
   * callback שמוזרק ל-createClientImpl.onCreateElicitation (בשלושת ה-call-sites: attach,
   * loadSession, replay של חיבור מחדש). מוחזר Promise שנפתר כש-resolveElicitation/cancelElicitation
   * נקראים, או כש-#client מתאפס (כל נקודות ה-teardown — ר' #resolvePendingElicitation).
   * בניגוד ל-#onRequestPermission — אין כאן bypass auto-allow (לא רלוונטי לשאלות מובנות;
   * לא בסקופ הבריף).
   */
  #onCreateElicitation = (params: ElicitationParams): Promise<ElicitationResponse> => {
    return new Promise<ElicitationResponse>((resolve) => {
      // pending יחיד — בקשה שנייה סוגרת את הקודמת כ-cancel (מחקה את דפוס ה-permission).
      if (this.pendingElicitation) {
        this.#resolvePendingElicitation({ action: "cancel" })
      }
      this.pendingElicitation = { params, resolve }
    })
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
   * ⚠️ **חובה** לקרוא מכל נקודה ש-#client מתאפס/הסשן נסגר, אחרת Promise דולף + turn תקוע
   * (הסיכון #1, יורש מ-A1): #cleanup (מכסה detach+leaveRunning), cancelTurn,
   * נתיבי reconnect דרך בעל החיבור.
   */
  #resolvePendingElicitation(response: ElicitationResponse): void {
    const pending = this.pendingElicitation
    if (!pending) return
    pending.resolve(response)
    this.pendingElicitation = null
  }

  // ─── פרומפטים (prompting) ────────────────────────────────────

  /**
   * שולח פרומפט (טקסט + אופציונלי attachments). `opts.recordingId` שמור עבור slice 10.
   * מחזיר Promise שמסתיים כשהתור מושלם (או נדחה בשגיאה).
   *
   * ─── slice-image-paste Commit 4b ───
   * opts.attachments — תמונות שנדחסו (ImageAttachment[]) — נשלחות כ-image blocks.
   * guard: if (!text.trim() && atts.length === 0) → לא שולח (finding אביגיל r2).
   * תמונה-בלבד (בלי טקסט): content = [image-blocks בלבד] (ללא text-block ריק).
   */
  sendPrompt = async (
    text: string,
    opts?: { recordingId?: string; attachments?: { mimeType: string; dataBase64: string }[] },
  ): Promise<void> => {
    if (this.status !== "connected") return
    // ─── slice view-switch C3-ב.1: guard תוקן — remote עובר עם #view, לא #client/#sessionId ───
    if (!this.#remoteView() && (!this.#client || !this.#sessionId)) return
    // ─── slice-image-paste Commit 4b: guard מורחב — תמונה-בלבד מותרת ───
    const atts = opts?.attachments ?? []
    if (!text.trim() && atts.length === 0) return

    // Slice 4: לכידה לטובת הקשר הקריינות
    this.lastUserMessage = text

    // ─── slice-image-paste Commit 4b: בניית content (PromptBlocks) — נצרך בענף local בלבד ───
    const content: PromptBlocks = [
      ...(text.trim() ? [{ type: "text" as const, text }] : []),
      ...atts.map((a) => ({ type: "image" as const, mimeType: a.mimeType, data: a.dataBase64 })),
    ]

    // ─── slice view-switch C3-ב.3: אופטימי רק ב-local — ב-remote ה-BE מסנתז את בועת-המשתמש ───
    if (!this.#remoteView()) {
      const userBubble: UserBubble = {
        id: safeUUID(),
        kind: "user",
        messageId: null,
        createdAt: Date.now(),
        segments: [{ id: safeUUID(), text }],
        ...(opts?.recordingId !== undefined ? { recordingId: opts.recordingId } : {}),
        // ─── slice-image-paste Commit 4b: attachments לבועה אופטימית ───
        ...(atts.length > 0
          ? { attachments: atts.map((a) => ({ mimeType: a.mimeType, dataBase64: a.dataBase64 })) }
          : {}),
      }
      this.#transcript.appendOptimistic(userBubble)
    }
    this.#setTurnState("waiting")
    this.#resetTurnTracking() // תחילת תור — #turnEnded=false + נקה טיימר יתום

    try {
      // ⚠️ אין meta ב-scope של sendPrompt — נבנה כאן, אחרת tsc נופל על Cannot find name
      const meta = opts?.recordingId !== undefined ? { recordingId: opts.recordingId } : undefined
      const remoteView = this.#remoteView()
      if (remoteView) {
        await remoteView.prompt(content, meta)
        // ⚠️ סיום-התור **לא** מסומן כאן — ה-202 אינו סוף התור. ב-remote view.prompt()
        // נפתר מיד עם ה-202 (ה-route הלא-חוסם); סיום-התור מגיע מה-patches
        // (applyTurnEnd, slice הבסיס) → #syncFromViewState → #setTurnState.
      } else {
        // narrowing מקומי חובה (typecheck) — הguard למעלה כבר הבטיח #client/#sessionId,
        // אבל TS לא יודע לצמצם דרך שדה-מחלקה שני (#view) בין ה-if-ים.
        const client = this.#client
        const sid = this.#sessionId
        if (!client || !sid) return
        await client.prompt(sid, content)
        // RESP הגיע — opencode: tail עוד יבוא; gemini/claude: סוף
        this.#turnEnded = true
        this.#setTurnState("idle") // נכון ל-gemini/claude. opencode: tail יטופל ב-#onSessionUpdate
      }
    } catch (err: unknown) {
      this.#turnEnded = true
      this.#setTurnState("idle")
      // slice auth-guidance: formatAcpError (data.details→data.message→message) במקום
      // err.message הגולמי — היה מציג "Internal error" גנרי (claude: auth_required).
      this.error = `prompt failed: ${formatAcpError(err)}`
      // ─── slice view-switch C3-ב.5: #setStatus("error") רק ב-local ───
      // ב-remote דחיית-שיגור (למשל 404 חולף) הייתה נועלת sendPrompt לצמיתות (status
      // מתחיל ב-guard status!=="connected") — בזמן שה-SessionHost חי לגמרי. השגיאה
      // עדיין מוצגת בשני המצבים (this.error למעלה, ללא תנאי).
      if (!this.#remoteView()) this.#setStatus("error")
    }
  }

  // ─── התמדת סשן (session persistence) ─── (מ-slice 8)

  /**
   * טוען סשן ACP קיים לפי sessionId.
   * דומה ל-attach() אך קורא ל-loadSession במקום ל-newSession.
   * לאחר ההשלמה, המצב הוא "connected" והסשן מוכן עבור sendPrompt.
   */
  loadSession = async (
    input: {
      sessionId: string
      cwd: string
      cliKind: string
      title?: string // ← slice session-title: תוספתי (קוראים קיימים לא נשברים)
      titleManual?: boolean
    },
    // Reconnect keeps the old session identity until replay and adoption complete.
    // בטעינה-ראשונית/switchSession/newSession (בלי opts) — התנהגות ללא שינוי (#cleanup מלא).
    opts?: {
      preserveContextOnError?: boolean
      isCurrent?: () => boolean
      onCreatedAgent?: (agentId: string) => void
    },
  ): Promise<void> => {
    // ─── slice view-switch C3-ה: חסימת נתיבי-WS ב-remote — פותח createAgent/WsAcpTransport ───
    if (this.#remoteView()) return
    if (this.status === "connecting" || this.status === "connected") {
      throw new Error(`cannot loadSession in status ${this.status}`)
    }
    if (!opts?.preserveContextOnError) {
      this.#endSessionScope("load")
    }
    this.#setStatus("connecting")
    this.error = null
    this.authMethods = [] // slice auth-guidance: נקה לפני חיבור חדש — נלכד מחדש אחרי createAcpClient
    this.#errorSurfaced = false // calev-heavy §10.2: סשן חדש לא יורש כשל טרמינלי קודם
    this.#transcript.replace([])
    this.sessionState = createInitialSessionState({ sessionId: input.sessionId })
    this.#detached = false

    // ─── DEV-only: mock session (sessionId "mock:<name>") ───
    // זורם updates גולמיים מ-fixture דרך אותו #onSessionUpdate כמו ACP חי —
    // ללא createAgent/WS/ACP. כלי דיבוג עיצוב; tree-shaken מ-prod build.
    if (import.meta.env.MODE !== "production" && input.sessionId.startsWith("mock:")) {
      await loadMockSession(
        this.#loadMockSessionDeps(this.#bindLocalView(input.sessionId)),
        input.sessionId.slice("mock:".length),
        input.cwd,
      )
      return
    }

    this.#resetTurnTracking() // NBug3: תור קודם השאיר #turnEnded=true + timer יתום

    const owner =
      opts?.preserveContextOnError && this.#connection instanceof WsConnection
        ? this.#connection
        : this.#newWsConnection()
    this.#connection = owner
    let createdAgentId: string | undefined
    let createdTransport: WsAcpTransport | undefined
    let createdClient: AcpClient | undefined
    const current = () => opts?.isCurrent?.() ?? true
    const cancelled = () => {
      if (createdTransport) owner.discardTransport(createdTransport)
      if (createdAgentId) void deleteAgent(createdAgentId).catch(() => {})
      if (createdClient && this.#client === createdClient) this.#client = null
    }

    try {
      // 1. צור סוכן בצד השרת (זהה ל-attach)
      const { agentId } = await createAgent({ cwd: input.cwd, cliKind: input.cliKind })
      createdAgentId = agentId
      opts?.onCreatedAgent?.(agentId)
      if (!current()) {
        cancelled()
        return
      }
      if (!opts?.preserveContextOnError) this.agentId = agentId
      this.cwd = input.cwd
      this.#cliKind = input.cliKind // slice ws-reconnect-infra: שמור ל-cold reconnect

      // 2. פתח תעבורת WS + הוסף מאזין onClose (זהה ל-attach)
      const transport = new WsAcpTransport(this.#agentWsUrl(agentId))
      createdTransport = transport
      owner.adoptTransport(transport)
      transport.onClose((code, reason) => {
        if (owner.transport !== transport) return
        if (this.#detached) return
        if (this.#tearingDown) return // NBug2: סגירה מכוונת ב-cold — אל תצית reconnect
        if (code !== 1000 && code !== 1001) {
          void this.#handleUnexpectedClose(code, reason)
        }
      })
      await transport.waitForOpen()
      if (!current()) {
        cancelled()
        return
      }

      // 3. לחיצת יד של ACP (זהה ל-attach)
      // slice local-view-wiring C3: bind+tee לפני יצירת הלקוח; adopt **לפני** loadSession —
      // ההיסטוריה המשוחזרת מגיעה תוך כדי ה-await, ואימוץ אחריו מוחק אותה (§2.6/§4.4).
      const localView = this.#bindLocalView()
      const client = await createAcpClient(transport, this.#callbacksForLocalView(localView))
      createdClient = client
      if (!current()) {
        cancelled()
        return
      }
      this.#client = client
      this.authMethods = client.authMethods // slice auth-guidance: ללכידה בכשל loadSession/prompt מאוחר יותר
      this.#ext = createExtClient(client)
      // slice local-view-wiring C3 — נקודת-אימוץ 2: sessionId ידוע (input.sessionId),
      // מיד אחרי יצירת הלקוח ולפני ה-try של ה-replay.
      this.#adoptLocalView(client, input.sessionId)

      // ── קריאה ל-loadSession במקום ל-newSession ──
      // השתק את ה-TTS של ה-Speaker במהלך ניגון מחדש של ההיסטוריה (slice 4: replay-quiet).
      this.isLoadingHistory = true
      try {
        const m = this.#sessionMeta()
        const loadResult = await client.loadSession({
          sessionId: input.sessionId,
          cwd: input.cwd,
          mcpServers: [],
          ...(m && { _meta: m }),
        })
        if (!current()) {
          cancelled()
          return
        }
        this.#captureSessionConfig(loadResult) // slice 23: לכוד config (sessionId מ-input, לא מ-response)
      } finally {
        if (current()) {
          this.isLoadingHistory = false
          this.#setTurnState("idle") // NBug3: replay מסתיים — reset turnState (replay אינו תור)
        }
      }
      this.#enterSession(input.sessionId)
      this.#applyTitleFromSessionInput(input)

      // 4. הודע ל-BE (זהה ל-attach, מאמץ מיטבי)
      await notifySessionAttached(agentId, input.sessionId).catch(() => {})
      if (!current()) {
        cancelled()
        return
      }

      this.agentId = agentId
      this.#setStatus("connected")
    } catch (e) {
      if (!current()) {
        cancelled()
        return
      }
      this.error = `loadSession failed: ${formatAcpError(e)}`
      this.#setTurnState("idle") // NBug3: throw מוקדם (createAgent/waitForOpen) — ה-finally הפנימי לא רץ
      // slice reconnect-recovery: נתיב-השימור (cold-reconnect שנכשל) — לא #cleanup() מלא
      // (שהיה מוחק #sessionId/agentId ותוקע את reconnect() ב-early-return). שומר את
      // הקשר-הסשן כדי שלחיצת reconnect הבאה תמצא #sessionId ותנסה שוב (§3 diagram).
      if (opts?.preserveContextOnError) {
        this.#errorSurfaced = true // חובה: ה-WS close אסינכרוני ורץ אחרי ניסיון cold
        // מאפס #tearingDown=false → guard 601 (#errorSurfaced) הוא מה שמונע clobber+
        // auto-reconnect על ה-async close (אביגיל r3 🔴).
        this.#cleanup({ keepContext: true }) // teardown מלא; אותו owner נשמר לניסיון הבא
        this.#setStatus("disconnected") // מציג כפתור reconnect; reconnect() לא-early-return (context נשמר)
      } else {
        this.#errorSurfaced = true // calev-heavy §10.2: כשל טרמינלי — #cleanup הורג את ה-WS
        this.#setStatus("error")
        this.#cleanup()
      }
    }
  }

  // ─── slice ws-reconnect-infra: reconnect ציבורי ─── (תוספתי)

  /**
   * משחזר את החיבור לסשן הנוכחי. warm-first: אם הסוכן עוד חי בצד השרת —
   * מתחבר אליו בלי spawn; אחרת יוצר חדש (cold). מאפס reconnectAttempt
   * ועוצר לולאת backoff פעילה (קריאה ידנית גוברת).
   */
  reconnect = async (): Promise<void> => {
    if (this.#sessionId === null || this.cwd === null || this.#cliKind === null) return
    await this.#connection?.reconnect()
  }

  // ─── slice reconnect-warm-attach: חיבור מחדש ל-agent חי מהווידג'ט ─── (תוספתי)

  /** Warm-attach to a live BE agent after refresh (widget reconnect). */
  attachToLiveAgent = async (
    input: {
      agentId: string
      sessionId: string
      cwd: string
      cliKind: string
    } & ManualTitleInput,
  ): Promise<void> => {
    if (this.#remoteView()) return
    // Validate before any mutation: runtime callers may bypass the TypeScript contract.
    if (!input.sessionId) throw new Error("existing WS agent requires sessionId")
    const connection =
      this.#connection instanceof WsConnection ? this.#connection : this.#newWsConnection()
    this.#connection = connection
    await connection.open({ ...input, kind: "existing-ws" })
  }

  // ─── slice fix-switch-session-warm: החלפת סשן ב-warm reload ─── (תוספתי)

  /**
   * החלפת סשן על החיבור הקיים — warm reload.
   * דורש #client פעיל. קורא ל-loadSession של ACP על אותו WS/bridge (ללא createAgent/WS חדש).
   * אם אין #client — נופל ל-loadSession הכבד (יצירת agent חדש).
   *
   * למה לא detach+loadSession: detach הורג את ה-bridge וגורם ל-race של WS closed (1005)
   * + spawn מיותר. כאן משתמשים בחיבור הקיים — מיידי, ללא race.
   * (אומת: opencode session/load עובד cross-cwd על אותו bridge.)
   */
  switchSession = async (input: {
    sessionId: string
    cwd: string
    cliKind: string
    title?: string // ← slice session-title: תוספתי
    titleManual?: boolean
  }): Promise<void> => {
    // ─── slice remote-session-mgmt C5: remote switch through the SessionHost ───
    // (replaces the blanket view-switch C3-ה block — the WS-opening paths stay
    // blocked; the switch itself now goes through view.loadSession → rpc).
    const remoteView = this.#remoteView()
    if (remoteView) {
      // serial guard on entry — the local path blocks on status !== connected;
      // without this guard overlapping switches would interleave steps on the host.
      if (this.status !== "connected" || this.isLoadingHistory) {
        throw new Error(`cannot switchSession in status ${this.status}`)
      }
      this.#endSessionScope("switch")
      this.error = null // parity with the local path — a stale error must not survive
      this.isLoadingHistory = true // silences TTS during the replay (like local)
      try {
        await remoteView.loadSession(input.sessionId, input.cwd)
        // Direct assignment — #syncFromViewState does NOT sync sessionId; cannot rely on it.
        this.#enterSession(input.sessionId)
        // Parity with the local success path: cwd + title (the BE reset preserves
        // the old title — without this assignment session A's title would stay)
        // + push to the server.
        this.cwd = input.cwd
        this.#applyTitleFromSessionInput(input)
      } catch (e) {
        this.error = `switchSession failed: ${formatAcpError(e)}`
      } finally {
        this.isLoadingHistory = false
      }
      return
    }
    // אין חיבור פעיל → נתיב כבד (דפנסיבי; ה-panel מוצג רק עם חיבור)
    if (this.#client === null) {
      return this.loadSession(input)
    }
    // לא להחליף באמצע thinking/connecting
    if (this.status !== "connected") {
      throw new Error(`cannot switchSession in status ${this.status}`)
    }
    // DEV mock: עדיין דרך הנתיב הכבד (mock לא רץ על #client חי)
    if (import.meta.env.MODE !== "production" && input.sessionId.startsWith("mock:")) {
      return this.loadSession(input)
    }

    this.#resetTurnTracking() // NBug3: תור קודם השאיר #turnEnded=true + timer יתום
    this.#endSessionScope("switch")
    this.#setStatus("connecting")
    this.error = null
    this.#errorSurfaced = false // calev-heavy §10.2: סשן חדש לא יורש כשל טרמינלי קודם
    this.#transcript.replace([])

    // slice local-view-wiring C3 — נקודת-אימוץ 4: **אותו לקוח**, בלי dispose ובלי
    // בנייה מחדש (ה-tee קפוא על ה-view שנוצר ביצירת הלקוח — §4.3). adopt לפני ה-replay:
    // ההיסטוריה מגיעה תוך כדי loadSession, ואימוץ אחריו מוחק אותה (§4.4).
    this.#adoptLocalView(this.#client, input.sessionId)

    try {
      this.isLoadingHistory = true
      try {
        const m = this.#sessionMeta()
        const loadResult = await this.#client.loadSession({
          sessionId: input.sessionId,
          cwd: input.cwd,
          mcpServers: [],
          ...(m && { _meta: m }),
        })
        this.#captureSessionConfig(loadResult)
      } finally {
        this.isLoadingHistory = false
        this.#setTurnState("idle") // NBug3: replay מסתיים — reset turnState
      }
      this.#enterSession(input.sessionId)
      this.cwd = input.cwd
      this.#applyTitleFromSessionInput(input)

      // הודע ל-BE על הסשן החדש (best-effort, אותו agentId הקיים)
      // replace:true — warm switch מכוון, מאפשר דריסת sessionId קיים (עוקף guard MED-9)
      // cwd — §3.5 D6: switchSession מחזיק מקור-אמת ל-cwd (מרשימת-הסשנים) ומשנה תיקייה;
      // בלי זה registry/projectsRegistry נשארים על ה-cwd הישן אחרי F5 (DoD 9/10).
      if (this.agentId) {
        await notifySessionAttached(this.agentId, input.sessionId, {
          replace: true,
          cwd: input.cwd,
        }).catch(() => {})
      }

      this.#setStatus("connected")
    } catch (e) {
      this.error = `switchSession failed: ${formatAcpError(e)}`
      this.#setTurnState("idle") // NBug3: throw מוקדם — ה-finally הפנימי אולי לא רץ
      this.#setStatus("error")
      // לא #cleanup — החיבור עדיין תקין; רק הטעינה נכשלה. השאר את ה-#client חי.
      // calev-heavy §10.2: לא מדליק #errorSurfaced — ה-WS נשאר חי; drop מאוחר יותר
      // צריך כן להצית reconnect (במקום להיתקע על ההודעה הישנה).
    }
  }

  // ─── slice new-session-warm: פתיחת סשן חדש warm ─── (תוספתי)

  /**
   * פתיחת סשן ACP חדש **על החיבור הקיים** — warm new-session.
   * דורש #client פעיל. קורא ל-newSession של ACP על אותו WS/bridge (ללא createAgent/WS חדש).
   * אם אין #client — נופל ל-attach הכבד (יצירת agent חדש) עם ה-cwd/cliKind שהועברו.
   *
   * שונה מ-switchSession: זה newSession (סשן ריק) ולא loadSession (היסטוריה קיימת).
   * אותה לוגיקת warm: אותו #client, אותו agentId, ללא detach/respawn.
   * למה לא detach+attach: detach הורג bridge + גורם ל-race "WS closed (1005)" + spawn מיותר.
   */
  newSession = async (input: { cwd?: string; cliKind: string }): Promise<void> => {
    // Warm new-session on the existing HTTP host (rpc session/new) — parity with
    // remote switchSession. Bubbles clear via SSE reset from the host.
    const remoteView = this.#remoteView()
    if (remoteView) {
      if (this.status !== "connected" || this.isLoadingHistory) {
        throw new Error(`cannot newSession in status ${this.status}`)
      }
      const cwd = input.cwd ?? this.cwd
      if (!cwd) throw new Error("newSession: no cwd")
      this.error = null
      this.#errorSurfaced = false
      this.#session.setManualTitle("", this.titleManual)
      this.isLoadingHistory = true
      try {
        await remoteView.newSession(cwd)
        const newId = remoteView.state.sessionId
        if (!newId) throw new Error("newSession returned no sessionId")
        this.#enterSession(newId)
        this.cwd = cwd
        // Empty title: skip #pushTitleToServer (it no-ops on !title) — host already
        // cleared title via update-session; agent list stays blank until a real title.
        await this.#applyRememberedConfig()
      } catch (e) {
        this.error = `newSession failed: ${formatAcpError(e)}`
      } finally {
        this.isLoadingHistory = false
      }
      return
    }
    const cwd = input.cwd ?? this.cwd
    // אין חיבור פעיל → נתיב כבד (דפנסיבי; ה-panel מוצג רק עם חיבור)
    if (this.#client === null) {
      if (!cwd) throw new Error("newSession: no cwd available for fallback attach")
      this.#endSessionScope("new")
      return this.attach({ cwd, cliKind: input.cliKind })
    }
    // לא לפתוח סשן חדש באמצע thinking/connecting
    if (this.status !== "connected") {
      throw new Error(`cannot newSession in status ${this.status}`)
    }
    if (!cwd) throw new Error("newSession: no cwd")

    this.#endSessionScope("new")
    this.#setStatus("connecting")
    this.error = null
    this.#errorSurfaced = false // calev-heavy §10.2: סשן חדש לא יורש כשל טרמינלי קודם
    this.#transcript.replace([])
    this.#session.setManualTitle("", this.titleManual) // slice session-title: סשן חדש = אין כותרת

    try {
      const m = this.#sessionMeta()
      const result = await this.#client.newSession({
        cwd,
        mcpServers: [],
        ...(m && { _meta: m }),
      })
      const newId = (result as { sessionId?: string }).sessionId ?? null
      if (!newId) throw new Error("newSession returned no sessionId")
      this.#enterSession(newId)
      this.cwd = cwd
      // slice local-view-wiring C3 — נקודת-אימוץ 5: **אותו לקוח**, בלי rebuild; אחרי
      // newSession (sessionId מהתשובה; סשן חדש = אין היסטוריה לאבד — §4.4).
      this.#adoptLocalView(this.#client, newId)
      this.#captureSessionConfig(result)

      // הודע ל-BE על הסשן החדש (best-effort, אותו agentId הקיים).
      // replace:true — מעבר מכוון לסשן אחר על אותו agent, עוקף guard MED-9.
      // cwd — §3.5 D6: newSession החם מחזיק מקור-אמת ל-cwd (מפורש/נגזר מ-input.cwd ?? this.cwd).
      if (this.agentId) {
        await notifySessionAttached(this.agentId, newId, { replace: true, cwd }).catch(() => {})
      }

      this.#setStatus("connected")
      // ─── slice-restore-last-config: החל בחירות אחרונות (אחרי connected — חובה) ───
      await this.#applyRememberedConfig()
    } catch (e) {
      this.error = `newSession failed: ${formatAcpError(e)}`
      this.#setStatus("error")
      // לא #cleanup — החיבור עדיין תקין; רק יצירת הסשן נכשלה. השאר את ה-#client חי.
      // calev-heavy §10.2: לא מדליק #errorSurfaced — ה-WS נשאר חי; drop מאוחר יותר
      // צריך כן להצית reconnect (במקום להיתקע על ההודעה הישנה).
    }
  }

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

  // ─── slice FEAT-thinking-live: setThinkingTokens ─── (תוספתי)

  /**
   * מגדיר את מגבלת ה-thinking tokens דרך ה-ext facade.
   * n=null → כבוי (no-limit). מדלג בשקט אם אין חיבור פעיל או ה-ext לא זמין.
   * נפרד מ-applyConfigOption — זהו ext (_drive/*), לא configOption ACP סטנדרטי.
   */
  setThinkingTokens = async (n: number | null): Promise<void> => {
    if (this.status !== "connected") return
    if (!this.#ext || !this.#sessionId) return
    await this.#ext.setThinkingTokens(this.#sessionId, n)
  }

  // ─── slice session-budget-meter Commit 4: refreshQuota ─── (תוספתי)

  /**
   * מרענן את `quota` מ-`_drive/getQuota` (on-open בלבד — לא polling, brief §9 Q4).
   * ציבורית — הפופאובר קורא לה ב-on-open.
   *
   * כללים (brief §4 Commit 4):
   *   - `supports.usage===false` → אין request (ה-quota section מוסתר ב-UI ממילא).
   *     **חריג**: ה-DEV mock harness עוקף את הבדיקה הזו במפורש — mock sessions לא
   *     עוברות דרך `_drive/capabilities` האמיתי (אין #client/#ext ל-mock בכלל), ולכן
   *     `supports.usage` לא בהכרח true גם כש-mockState.capabilities מבקש usage:true
   *     (המיזוג ל-#capabilities מגיע ב-Commit 5). הבדיקה על sessionId+#mockQuota
   *     מספיקה כדי לזהות "זהו debug harness מכוון", לא request אמיתי.
   *   - dedupe: פתיחות מקבילות חולקות את אותו Promise, לא שולחות בקשות כפולות.
   *   - race safety: sessionId נלכד לפני ה-await; תשובה שמגיעה אחרי session
   *     switch/cleanup (`this.#sessionId !== capturedSessionId`) לא נכתבת.
   *   - error/unavailable → `quota=null`, `quotaLoading` מסתיים, אין קריסה ב-UI.
   *   - DEV-only mock harness: sessionId מתחיל "mock:" + `#mockQuota !== undefined` →
   *     מעתיק ל-quota בלי ext request (אותו flow open→refresh→render כמו production).
   */
  refreshQuota = async (): Promise<void> => {
    const sessionId = this.#sessionId
    if (sessionId === null) return

    const isMockWithSnapshot =
      import.meta.env.MODE !== "production" &&
      sessionId.startsWith("mock:") &&
      this.#mockQuota !== undefined

    if (!isMockWithSnapshot && !this.supports.usage) return

    // ─── slice http-state-gaps C4: ב-remote המכסה מגיעה מערוץ-המצב ───
    // ⚠️ בלי היציאה הזו, refreshQuota לא רק "לא מביא" — הוא **מוחק**:
    // ב-remote אין #ext (הוא נבנה מעל #client שאינו קיים שם), ולכן
    // #doRefreshQuota נופל ל-`quota = null` ודורס ערך תקין שכבר הגיע
    // מ-#syncFromViewState. ⇒ גם עם ה-BE מתוקן, המשתמשת לא תראה כלום.
    // ב-remote ה-BE קורא getQuota וכותב ל-state; ה-FE רק צורך.
    if (this.#remoteView() && !isMockWithSnapshot) {
      this.#session.applyPatch({ kind: "quota-loading", loading: false })
      return
    }

    if (this.#quotaFetchInFlight) {
      await this.#quotaFetchInFlight
      return
    }

    this.#session.applyPatch({ kind: "quota-loading", loading: true })
    const fetchPromise = this.#doRefreshQuota(sessionId).finally(() => {
      this.#quotaFetchInFlight = null
    })
    this.#quotaFetchInFlight = fetchPromise
    await fetchPromise
  }

  /** מבצע את בקשת ה-quota בפועל, עם guard נגד כתיבה אחרי session switch/cleanup. */
  #doRefreshQuota = async (sessionId: string): Promise<void> => {
    await doRefreshQuota(this.#quotaRefreshDeps(), sessionId)
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
   * מביא את רשימת הסשנים דרך החיבור ה-ACP הקיים (#client) — ללא spawn של סוכן.
   * cache: טעינה מוצלחת אחת; force=true מרענן. no-op אם אין חיבור פעיל (#client===null).
   * (slice connect-recent-projects: דף החיבור כבר לא משתמש ב-spawn — הוסר listSessionsForCwd.
   *  בחירת סשן נעשית מתוך הסשן הפעיל דרך SessionOptionsPanel.)
   */
  listSessions = async (force = false): Promise<void> => {
    const remoteView = this.#remoteView()
    let source: (() => Promise<SessionInfo[]>) | null
    if (remoteView) {
      // already normalized in the view (RemoteSessionView.listSessions)
      source = () => remoteView.listSessions()
    } else if (this.#client !== null) {
      source = async () => {
        const res = await this.#client!.listSessions()
        const raw = (res as { sessions?: unknown[] }).sessions ?? []
        return raw.map(normalizeSessionInfo)
      }
    } else {
      source = null
    }
    await this.sessionsCache.list(source, force)
  }

  // ─── slice session-delete: מחיקת סשן (session/delete) ─── (תוספתי)
  /**
   * מוחק session מ-`session/list` (store/persistence) דרך ACP `session/delete` — **לא**
   * הורג את ה-process (זה נעשה בנפרד ע"י `DELETE /api/agents/:id`, מסלול שונה — §1 הבריף).
   * no-op אם אין חיבור פעיל (`#client===null`) — גם הכפתור אמור להיות מוסתר (gate).
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
    this.#cancelPendingDialogs()
    // ─── slice view-switch C3-ג: עריכה נקודתית — רק הבלוק האמצעי מנותב לפי #view ───
    // ❌ ענף-מוקדם היה מדלג על שני ה-resolve למעלה ועל #setTurnState("idle") ⇒ דיאלוג-הרשאה תקוע.
    const remoteView = this.#remoteView()
    if (remoteView) {
      try {
        await remoteView.cancel()
      } catch {
        // best-effort — בכל מקרה נאלץ idle מקומית
      }
    } else {
      const c = this.#client
      const s = this.#sessionId
      if (!c || !s) return
      try {
        await c.cancel(s)
      } catch {
        // best-effort — בכל מקרה נאלץ idle מקומית
      }
    }
    this.#setTurnState("idle")
  }

  // ─── slice claude-thinking-meta: _meta helper ───

  /** _meta לפי ה-CLI הנוכחי. claude → thinking-display; אחר → undefined (אגנוסטי). */
  #sessionMeta(): Record<string, unknown> | undefined {
    return this.#cliKind === "claude" ? CLAUDE_SESSION_META : undefined
  }

  /** Best-effort PATCH title to BE for the active-processes list. */
  #pushTitleToServer(title: string): void {
    const id = this.agentId
    if (!id || !title) return // אין agentId / כותרת ריקה → דלג
    void patchAgent(id, { title }).catch(() => {})
  }

  setManualTitle(title: string): void {
    setManualTitleOnAgent(this.#session, this.agentId, title)
  }

  #applyTitleFromSessionInput(input: { title?: string; titleManual?: boolean }): void {
    applyTitleFromSessionInput(this.#session, input, (t) => this.#pushTitleToServer(t))
  }

  // ─── slice 6: setter מרכז ─── (additive — מנתב את כל ה-status writes)

  /**
   * נקודת-mutation יחידה ל-status. כל שינוי status עובר דרך כאן.
   * מנגן audio cue ב-transitions רלוונטיים (slice 6). אין $effect — קריאה מפורשת.
   * idempotent: אם next === prev — לא מנגן cue (אין transition).
   *
   * slice reconnect-bubble-merge (fix preview 2026-07-22): chokepoint יחיד לשחרור
   * ה-frozen-display snapshot של warm-reconnect. מעבר ל-"connected" = reconnect/load
   * הצליח בפועל (warm ~799 וגם cold דרך loadSession ~1200 עוברים דרך כאן) — רק אז
   * מותר לחשוף renderBubbles מחדש. אם #displaySnapshot כבר null (אין replay בעיצומו) —
   * no-op. כשל (status="error"/retry) לא מגיע לכאן — ה-snapshot נשאר קפוא (INVARIANT).
   */
  #setStatus(next: AgentSessionStatus): void {
    const prev = this.status
    if (next === prev) return
    this.status = next
    if (next === "error") this.#cues?.play("error")
    if (next === "connected") this.#transcript.connected()
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

  #cleanup(opts?: { keepAgent?: boolean; keepContext?: boolean }): void {
    this.#cancelViewReader()
    const transport = this.#connection instanceof WsConnection ? this.#connection.transport : null
    if (!opts?.keepContext) {
      this.#connection?.cancelReconnect()
      this.#connection = null
    }
    // לכוד את ה-agentId לפני האיפוס — צריך אותו ל-deleteAgent.
    const agentId = this.agentId
    // נקה timer של tail-debounce (msr-v2 — NBug1 opencode)
    if (this.#idleTimer !== null) {
      clearTimeout(this.#idleTimer)
      this.#idleTimer = null
    }
    // watchdog §2 — אין תור בלי סשן.
    this.#stopStallWatch()
    this.#turnActivity = onTurnEnded()
    this.turnStalled = false
    // ─── slice be-shutdown-hardening Commit 3: $/detach לפני סגירה מכוונת ───
    // keepAgent=true = leaveRunning — FE מודיע ל-BE שהוא עוזב מרצון.
    // ה-BE מקבל $/detach → markDetached מיד → reconnect-ghost נסגר מיידית
    // (במקום לחכות ל-sweep של ה-WS אחרי 60s).
    // slice-permission-ui-basic: פתור pending כ-cancelled **לפני** סגירת ה-#client — אחרת
    // התשובה נשלחת על חיבור סגור ואובדת. קריטי ל-keepAgent (leaveRunning) שבו ה-agent שורד
    // וממתין לתשובה; leaveRunning גם ממתין ל-flush (setTimeout 0) לפני שמגיע לכאן. מכסה
    // detach() (agent נהרג ממילא) + attach/loadSession כשל.
    this.#cancelPendingDialogs()
    if (opts?.keepAgent && transport) {
      sendDetachFrame(transport)
    } else if (opts?.keepAgent && this.#isRemote) {
      this.releaseConnection()
    }
    try {
      this.#client?.close()
    } catch {
      // כבר סגור
    }
    this.#client = null
    // ─── slice view-switch C3-ח: teardown ה-view (remote) — נקודת-הפירוק היחידה ───
    // close() אינו זול (ממתין לשני round-trips של POST /reply לביטול pending) —
    // void חובה (אחרת #cleanup הסינכרונית הייתה צריכה להפוך ל-async). ה-.catch הוא
    // חגורת-ביטחון בלבד — close() תופס בפנים את שתי קריאות ה-respond.
    void this.#view?.close().catch(() => {})
    this.#view = null
    this.#localView = null // slice local-view-wiring C3: איפוס כפול לצד #view (§4.3)
    this.#isRemote = false // slice local-view-wiring C1: איפוס מתג-המצב לצד איפוס ה-view
    // ─── slice view-switch C3-ו: מרחב-ה-ids של pending הוא פר-host, לא פר-VM ───
    // בלי איפוס — הדיאלוג הראשון של הסשן המרוחק הבא באותו טאב מדוכא בשקט (id 0 "כבר נענה").
    this.#answeredPermissionId = null
    this.#answeredElicitationId = null
    this.#ext = null // slice FE-normalization: נקה facade
    this.#capabilities = null // slice FE-normalization: נקה capabilities (חיבור חדש = caps חדשים)
    this.#session.applyPatch({ kind: "usage", usage: null }) // slice session-budget-meter: נקה context-usage
    this.#session.applyPatch({ kind: "quota", quota: null }) // slice session-budget-meter Commit 4: נקה quota
    this.#session.applyPatch({ kind: "quota-loading", loading: false })
    this.#mockQuota = undefined
    this.#quotaFetchInFlight = null
    this.#claudeRawSdkMessageCount = 0
    // slice subagent-transcript-data-v2: נקה state תעתיק תת-סוכן (חיבור חדש = index/pending חדשים)
    this.#subagentIndex = createSubagentIndex()
    this.#pendingByParent = []
    // slice subagent-tool-nesting: נקה מיפוי-קינון (חיבור חדש = מיפוי חדש)
    this.#session.clearSubagentParents()
    // slice reconnect-recovery: keepContext משמר #sessionId/agentId כדי ש-reconnect()
    // הציבורי לא יעשה early-return אחרי כשל cold-reconnect (§4 Commit 0).
    if (!opts?.keepContext) {
      this.#sessionId = null
      this.agentId = null
    }
    // הורג את ה-bridge בצד ה-BE. ה-BE לא הורג את ה-child בסגירת WS לבד
    // (ws-agent.ts:126 — בכוונה, לאפשר reconnect עתידי), לכן ה-FE אחראי
    // לבקש מחיקה מפורשת. fire-and-forget — לא חוסם, לא זורק (cleanup רץ גם
    // ב-error path; ראה sessions.ts:71 לאותו דפוס).
    // ─── slice leave-running-background: keepAgent=true → לא הורג (ה-child שורד) ───
    // slice reconnect-recovery: keepContext גם מונע deleteAgent — ה-agent אמור לשרוד
    // ל-reattach (בעל החיבור מטפל במחיקת ה-agent הישן בנפרד, אחרי הצלחה).
    if (!opts?.keepAgent && !opts?.keepContext && agentId) void deleteAgent(agentId).catch(() => {})
  }

  #loadMockSessionDeps(view: LocalSessionView): LoadMockSessionDeps {
    return {
      setCwd: (cwd) => {
        this.cwd = cwd
      },
      setSessionTitle: (title) => {
        this.#session.setManualTitle(title, this.titleManual)
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
      resetTurnTracking: () => this.#resetTurnTracking(),
      setTurnState: (state) => this.#setTurnState(state),
      onSessionUpdate: (n) => view.observerCallbacks.onUpdate?.(n),
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
      this.#claudeRawSdkMessageCount += 1
      return
    }
    // finding #2: ענף _drive/capabilities (וכל ענף עתידי) — ללא שינוי.
    if (method === "_drive/capabilities") {
      this.#capabilities = params as unknown as NormalizedCapabilities
    }
  }

  #applySubagentDisplay(params: Record<string, unknown>): void {
    const ev = parseClaudeSdkMessage(params)
    if (ev.kind === "ignored") return
    const parentId = this.#subagentIndex.resolve(ev)
    if (parentId === undefined) return
    if (!this.#transcript.applySubagentEvent(parentId, ev))
      this.#pushPendingSubagentEvent(parentId, ev)
  }

  /** דוחף אירוע-תת-סוכן שממתין ל-Task ToolBubble שטרם נוצר. bounded (drop-oldest) — §7 Risks. */
  #pushPendingSubagentEvent(parentId: string, event: ClaudeSubagentEvent): void {
    this.#pendingByParent.push({ parentId, event })
    if (this.#pendingByParent.length > AgentSession.#SUBAGENT_PENDING_CAP) {
      this.#pendingByParent.shift()
    }
  }

  /** מפעיל אירועי-תת-סוכן שהמתינו ל-Task ToolBubble הזה (נקרא מ-#applyToolCall). */
  #flushPendingSubagentEvents(toolCallId: string): void {
    if (this.#pendingByParent.length === 0) return
    const matching = this.#pendingByParent.filter((p) => p.parentId === toolCallId)
    if (matching.length === 0) return
    this.#pendingByParent = this.#pendingByParent.filter((p) => p.parentId !== toolCallId)
    this.#transcript.applySubagentEvents(
      toolCallId,
      matching.map((item) => item.event),
    )
  }

  #onSessionUpdate = (notification: FrameInput, frame?: ViewFrame): void => {
    for (const patch of frame?.displayIntents ?? toPatches({ update: notification.update })) {
      if (patch.kind === "observed") {
        if (frame && !this.#isRemote) continue
        this.#onUpdateObserved?.(patch.update)
        this.#noteAgentActivity()
        continue
      }
      if (patch.kind === "ext-notification") {
        if (!frame || this.#isRemote) this.#onExtNotification(patch.method, patch.params)
        if (frame && patch.method === "_claude/sdkMessage") this.#applySubagentDisplay(patch.params)
        continue
      }
      if (!frame) continue
      const update = patch.update as {
        sessionUpdate?: string
        content?: {
          type?: string
          text?: string
          data?: string
          mimeType?: string
          name?: string
          uri?: string
        }
        messageId?: string | null
        toolCallId?: string
        title?: string | null
        kind?: string
        rawInput?: unknown
        rawOutput?: unknown
        status?: ToolCall["status"]
        locations?: unknown[] | null
      }
      if (patch.kind === "tool-call") {
        const parentToolUseId = extractParentToolUseId(patch.update)
        if (parentToolUseId !== undefined) {
          handleSubagentToolCall(
            this.#subagentToolNestingDeps(frame.corePatches),
            update as Parameters<typeof handleSubagentToolCall>[1],
            parentToolUseId,
          )
        } else {
          this.#applyToolCall(update, frame.corePatches)
        }
        continue
      }
      if (patch.kind === "tool-call-update") {
        if (update.toolCallId !== undefined && this.#session.hasSubagentParent(update.toolCallId)) {
          handleSubagentToolCallUpdate(
            this.#subagentToolNestingDeps(frame.corePatches),
            update as Parameters<typeof handleSubagentToolCallUpdate>[1],
          )
        } else {
          const parentToolUseId = extractParentToolUseId(patch.update)
          const parentBubbleExists =
            parentToolUseId !== undefined &&
            this.bubbles.some((b) => b.kind === "tool" && b.toolCall.toolCallId === parentToolUseId)
          const childAlreadyTopLevel =
            update.toolCallId !== undefined &&
            this.bubbles.some(
              (b) => b.kind === "tool" && b.toolCall.toolCallId === update.toolCallId,
            )
          if (parentToolUseId !== undefined && parentBubbleExists && !childAlreadyTopLevel) {
            handleSubagentToolCall(
              this.#subagentToolNestingDeps(frame.corePatches),
              update as Parameters<typeof handleSubagentToolCall>[1],
              parentToolUseId,
            )
          } else {
            if (update.status === "pending" || update.status === "in_progress") {
              this.#setTurnState("calling-tool")
              if (this.#turnEnded) this.#scheduleIdle()
            }
            this.#transcript.applyPatch({ kind: "frame", patches: frame.corePatches })
          }
        }
        continue
      }
      if (patch.kind === "mode") {
        const modeId = (update as { currentModeId?: unknown }).currentModeId
        if (typeof modeId === "string") {
          this.modes = { availableModes: this.modes?.availableModes ?? [], currentModeId: modeId }
        }
        continue
      }
      if (patch.kind === "config") {
        const opts = (update as { configOptions?: unknown }).configOptions
        if (Array.isArray(opts)) this.configOptions = opts as SessionConfigOption[]
        continue
      }
      if (patch.kind === "commands") {
        const cmds = (update as { availableCommands?: unknown }).availableCommands
        this.#session.applyPatch({
          kind: "commands",
          commands: Array.isArray(cmds) ? (cmds as AvailableCommand[]) : [],
        })
        continue
      }
      if (patch.kind === "plan") {
        this.#session.applyPatch({ kind: "plan", plan: reducePlan(this.planStore, update) })
        continue
      }
      if (patch.kind === "usage") {
        const u = update as unknown as UsageUpdate
        this.#session.applyPatch({
          kind: "usage",
          usage: { used: u.used, size: u.size, cost: u.cost ?? this.contextUsage?.cost },
        })
        continue
      }
      if (patch.kind === "title") {
        if (this.titleManual) continue
        const title = update.title
        if (title === null) {
          this.#session.applyPatch({ kind: "title", title: "" })
        } else if (typeof title === "string") {
          this.#session.applyPatch({ kind: "title", title })
          this.#pushTitleToServer(this.sessionTitle)
        }
        continue
      }
      if (
        patch.kind === "user-text" ||
        patch.kind === "user-image" ||
        patch.kind === "user-resource-link" ||
        patch.kind === "user-audio" ||
        patch.kind === "user-placeholder"
      ) {
        const messageId = patch.messageId
        if (messageId !== null) this.#transcript.setMessageId(messageId)
        if (patch.kind === "user-text") {
          this.#transcript.applyPatch({ kind: "frame", patches: frame.corePatches })
        } else {
          this.#transcript.appendNonText(patch, update.content)
        }
        continue
      }
      if (
        patch.kind === "agent-text" ||
        patch.kind === "agent-resource-link" ||
        patch.kind === "agent-image" ||
        patch.kind === "agent-audio" ||
        patch.kind === "agent-placeholder"
      ) {
        this.#setTurnState("responding")
        if (this.#turnEnded) this.#scheduleIdle()
        if (patch.kind === "agent-text") {
          this.#transcript.applyPatch({ kind: "frame", patches: frame.corePatches })
        } else {
          this.#transcript.appendNonText(patch, update.content)
        }
        continue
      }
      if (patch.kind === "thought-text") {
        this.#setTurnState("thinking")
        if (this.#turnEnded) this.#scheduleIdle()
        this.#transcript.applyPatch({ kind: "frame", patches: frame.corePatches })
        continue
      }
      this.#transcript.applyPatch({ kind: "frame", patches: frame.corePatches })
    }
  }

  // ─── slice session-state-reducer C4: מתודת-עזר ל-tool_call create (reduce + patches + flush + turnState) ───

  /**
   * #applyToolCall — מיישג tool_call create דרך reduce + applyPatchMutable.
   * קרוא משני מקומות: (1) dispatch tool_call של #onSessionUpdate (non-subagent),
   * (2) fallback של #handleSubagentToolCall (אב לא נמצא — אביגיל r4 #1).
   */
  #applyToolCall(update: Record<string, unknown>, patches: Patch[]): void {
    this.#transcript.applyPatch({ kind: "frame", patches })
    // flush pending subagent events for this toolCallId (slice subagent-transcript-data-v2)
    if (typeof update.toolCallId === "string") {
      this.#flushPendingSubagentEvents(update.toolCallId)
    }
    // turnState תמיד calling-tool ללא תנאי (create, לא update)
    this.#setTurnState("calling-tool")
    if (this.#turnEnded) this.#scheduleIdle()
  }
}
