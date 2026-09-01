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
  SessionNotification,
  UsageUpdate,
} from "@agentclientprotocol/sdk"
import { WsAcpTransport } from "@drive-coding/acp-wire/browser"
// ─── slice reconnect-ws-takeover: תרגום נקודתי להודעת "נפתח במקום אחר" ───
// ה-VM לרוב לא מייבא t() (i18n שייך לשכבת-הרכיב — ר' #appendUserPlaceholder), אבל
// `error` הוא string גולמי שמוצג as-is (routes/+page.svelte:191, לא עובר t() ברכיב) —
// כמו הודעות "WS closed (...)" הקיימות. חייב לעבור דרך core/i18n (לא Hebrew ליטרלי
// בקוד — lint:i18n אוכף), ולא להשתמש ב-I18nVM (לא מוזרק ל-VM הזה).
import { createI18n, detectLocale } from "@drive-coding/core/i18n"
import {
  type AcpClient,
  createAcpClient,
  createAttachedAcpClient,
  // ─── slice-image-paste Commit 4a/4b: טיפוס blocks לשליחה מולטימודלית ───
  type PromptBlocks,
} from "@drive-coding/provider/client"
import { tick } from "svelte"
import {
  createAgent,
  deleteAgent,
  getAgent,
  listAgents,
  notifySessionAttached,
  patchAgent,
  releaseConnection,
} from "$lib/adapters/agents-api"
// ─── slice sessions-inline: ייבוא טיפוס + normalize ───
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
// ─── slice view-switch C3: createRemoteView (attachRemote) ─── (additive)
import { createRemoteView } from "$lib/session/create-session-view"
// ─── slice local-view-wiring: LocalSessionView + tee ───
import { LocalSessionView } from "$lib/session/local-session-view"
// ─── slice session-view-port C3: SessionView DI ───
import type { SessionView } from "$lib/session/session-view"
import { teeAcpCallbacks } from "$lib/session/tee-acp-callbacks"
import type {
  Bubble,
  MessageBubble,
  Segment,
  ThoughtBubble,
  ToolBubble,
  ToolCall,
  ToolContent,
  ToolLocation,
  UserBubble,
} from "$lib/types/bubble"
// ─── slice-elicitation-ui: טיפוסי שאלה מובנת (view-model layer, נגזרים מ-SDK) ───
import type { ElicitationParams, ElicitationResponse } from "$lib/types/elicitation"
// ─── slice-permission-ui-basic: טיפוסי בקשת-הרשאה (view-model layer, נגזרים מ-SDK) ───
import type { PermissionParams, PermissionResponse } from "$lib/types/permission"
import { connInfo, connWarn } from "$lib/util/conn-log"
import { isBypassMode } from "$lib/util/permission-mode"
import { safeUUID } from "$lib/util/uuid"
// ─── slice surface-real-error: עדיפות data.details→data.message→message→String(e) ───
import { formatAcpError } from "$lib/view-models/format-acp-error"
import type { Settings } from "$lib/view-models/settings.svelte"

// ─── image-attach kill-switch ─── (slice-image-paste Commit 2)
// Commit 4b הפך ל-true — שליחה מולטימודלית פעילה.
// supportsImageInput קורא raw #client.capabilities.promptCapabilities.image
// (§10 הכרעה א — raw, לא NormalizedCapabilities).
const IMAGE_INPUT_ENABLED = true

// ─── slice warm-reattach-skip-init ───
// warm reattach אין לו תגובת initialize לשאוב raw capabilities ממנה.
// raw capabilities משמש רק supportsImageInput → known-limitation (image-paste):
// אחרי warm reattach אין קלט-תמונות עד connect קר. יתוקן בנרמול caps —
// ר' roadmap Track A "ניקוי/ארגון packages/provider" (normalize.ts raw↔normalized).
// NormalizedCapabilities מגיע מ-_drive/capabilities (BE) — לא מושפע.
const ATTACHED_CAPS_FALLBACK = {} as AcpClient["capabilities"]

// ─── slice plan-todo-list Commit 1: reducer טהור + טיפוסים ─── (additive)
import { EMPTY_PLAN_STORE, type PlanStore, reducePlan } from "@drive-coding/core/acp/plan"
// ─── slice session-state-reducer C4: reduce + types ─── (additive)
import {
  applyPatch,
  createInitialSessionState,
  type Patch,
  reduce,
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
import { applyPatchMutable } from "$lib/session/apply-patch-mutable"
import { mapLocations, mapToolContent } from "$lib/session/map-tool-content"
// ─── slice subagent-transcript-data-v2: פרסר+reducer טהורים (additive) ───
import {
  type ClaudeSubagentEvent,
  createSubagentIndex,
  parseClaudeSdkMessage,
  reduceSubagent,
} from "./claude-subagent-parse"
import { type HistoryMark, historyMarkFromReset } from "./history-mark.js"

/**
 * _meta שמוזרק ל-session/new+load של claude בלבד — מחזיר thinking summaries
 * ומבקש raw SDK frames ל-spike של subagent transcript.
 * Opus 4.7+ שינה default ל-display:"omitted"; זה מבקש "summarized" מפורשות.
 * provider-agnostic: ה-key claudeCode מתעלם ע"י ספקים אחרים.
 */
const CLAUDE_SESSION_META = {
  claudeCode: {
    options: {
      thinking: { type: "adaptive", display: "summarized" },
      forwardSubagentText: true,
    },
    emitRawSDKMessages: [
      { type: "system", subtype: "task_started" },
      { type: "system", subtype: "task_progress" },
      { type: "system", subtype: "task_notification" },
      { type: "system", subtype: "task_updated" },
      { type: "assistant" },
      // ─── slice subagent-transcript-data-v2 Commit 0 ───
      // בלי {type:"user"} תוצאות-הכלים (tool_result) של תת-הסוכן לא זורמות
      // (spike Q2, decisions 2026-07-11 — "🐛 פער בקוד שנחת ב-acp-stack").
      { type: "user" },
    ],
  },
} as const

// ─── slice subagent-tool-nesting: helper טהור לחילוץ parentToolUseId ───
/**
 * מחלץ `parentToolUseId` מ-`_meta.claudeCode` של frame גולמי של `session/update`.
 * `rawUpdate` הוא `notification.update` **לפני** ה-cast הטיפוסי ב-`#onSessionUpdate`
 * (ה-cast המקומי משמיט את `_meta` מהטיפוס אבל לא מהאובייקט בזמן-ריצה) — narrowing בטוח,
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

/** slice session-scope-core S1 — reason passed to onSessionEnd listeners. "navigate" reserved for S2. */
export type SessionEndReason =
  | "detach"
  | "leave-running"
  | "switch"
  | "new"
  | "load"
  | "delete"
  | "navigate"

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
  /**
   * slice local-view-wiring C3: ה-view המקומי, מטופס. `#view` מחזיק **את אותו אובייקט**
   * (בשביל `#cleanup`), אבל רק דרך השדה הזה קוראים ל-dispose/adopt/observerCallbacks —
   * `session-view.ts:94` (החוזה) מכריז close() בלבד, והטיפוס שלו שולל dispose.
   * ⚠️ לא `as LocalSessionView` על `#view` — הוא ישקר בשקט אם view של remote יגיע לשם.
   */
  #localView: LocalSessionView | null = null
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
      this.#isRemote = true // slice local-view-wiring C1: DI של view == remote (כל 5 הקונסטרוקציות)
      void this.#consumeViewPatches(opts.view)
    }
    // ─── slice ws-reconnect-infra: visibility tracking ───
    if (typeof document !== "undefined") {
      this.#pageHidden = document.hidden
      document.addEventListener("visibilitychange", () => {
        this.#pageHidden = document.hidden
      })
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
  bubbles = $state<Bubble[]>([])
  // ─── slice session-state-reducer C4: מצב SessionState פנימי (base ל-reduce) ─── (additive)
  sessionState = $state<SessionState>(createInitialSessionState({ sessionId: null }))
  // ─── slice reconnect-bubble-merge: frozen display בזמן warm-reconnect replay ───
  /** לא-null רק בזמן warm-reconnect replay (#warmReconnect) — מקפיא את התצוגה על הרשימה הישנה. */
  #displaySnapshot = $state<Bubble[] | null>(null)
  agentId = $state<string | null>(null)
  cwd = $state<string | null>(null)
  // ─── slice ws-reconnect-infra: reconnect state ─── (INVASIVE — מאושר)
  /** 0 = לא מנסה reconnect; >0 = ניסיון נוכחי (1-indexed לחיווי UI). */
  reconnectAttempt = $state<number>(0)
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
   * `resolve` הוא ה-resolver של ה-Promise שהוחזר ל-`createClientImpl.unstable_createElicitation`
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

  // ─── slice-slash-commands Commit 0: פקודות ה-slash שהספק חשף ─── (תוספתי)
  /** פקודות ה-slash שהספק חשף (available_commands_update). [] = אין/טרם. */
  availableCommands = $state<AvailableCommand[]>([])

  // ─── slice session-title: כותרת הסשן הפעיל ─── (תוספתי)
  /** כותרת הסשן הפעיל. snapshot מרגע הטעינה/החלפה. "" = אין כותרת (סשן חדש). */
  sessionTitle = $state<string>("")

  // ─── slice plan-todo-list Commit 1: תוכנית-עבודה חיה (TodoWrite/update_plan) ─── (תוספתי)
  /** מצב הצ'קליסט הנעוץ, מ-session/update מסוגי plan/plan_update/plan_removed. reducer טהור ב-core. */
  planStore = $state<PlanStore>(EMPTY_PLAN_STORE)

  // ─── slice session-budget-meter: context state מ-ACP usage_update התקני ─── (תוספתי)
  /**
   * מצב ניצול חלון-הקונטקסט + עלות, מתוך `session/update` מסוג `usage_update` (ACP תקני —
   * לא ext, לא `_meta._claude/rateLimit`). null = טרם התקבל update בסשן הנוכחי.
   * cost אופציונלי ב-ACP — אם update חדש משמיט אותו, הערך הקודם נשמר (למניעת flicker).
   */
  contextUsage = $state<UsageUpdate | null>(null)

  // ─── slice session-budget-meter Commit 4: quota (רב-ספקי, generic) ─── (תוספתי)
  /**
   * Snapshot מכסה גנרי (windows[]) מ-`_drive/getQuota`. null = אין מגבלות זמינות
   * (תגובה תקינה) **או** שהספק לא תומך (`supports.usage===false`) **או** שגיאה — ה-UI
   * מבחין ביניהם דרך `supports.usage` + `quotaLoading`, לא דרך ה-VM. מתעדכן רק דרך
   * `refreshQuota()` הציבורית (on-open, לא polling — brief §9 Q4).
   */
  quota = $state<QuotaSnapshot | null>(null)
  /** True בזמן בקשת `refreshQuota()` פעילה. */
  quotaLoading = $state(false)

  // ─── slice reconnect-bubble-merge: render-consumers (additive) ───
  /** רשימת התצוגה. בזמן warm-reconnect replay מוקפאת ל-snapshot; אחרת = live bubbles. */
  get renderBubbles(): Bubble[] {
    return this.#displaySnapshot ?? this.bubbles
  }

  /** true רק בזמן warm-reconnect replay (התצוגה קפואה). לא נדלק בטעינה ראשונית/switchSession. */
  get isReconnectReplay(): boolean {
    return this.#displaySnapshot !== null
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

  // ─── redesign-fix: רשימת סשנים inline ─── (תוספתי)
  sessions = $state<SessionInfo[]>([])
  sessionsLoading = $state<boolean>(false)
  sessionsError = $state<string | null>(null)
  #sessionsLoaded = false // True אחרי טעינה מוצלחת אחת — cache; force=true מרענן

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
  // ─── slice subagent-tool-nesting: קינון-כלים של תת-סוכן (additive) ───
  /**
   * מפת toolCallId (של כלי-בן) → parentToolUseId (toolCallId של בועת ה-Task האב).
   * נבנית ב-`#handleSubagentToolCall` (create), נקראת ב-`#handleSubagentToolCallUpdate` —
   * מקור-קישור אמין ל-tool_call_update, בלי תלות בשאלה אם ה-update עצמו נושא parentToolUseId
   * (חלק כן, חלק לא — brief §3 אביגיל #3). מתאפס ב-#captureSessionConfig/#cleanup.
   */
  #subagentToolCallParents: Map<string, string> = new Map()
  static readonly #SUBAGENT_PENDING_CAP = 50
  // ─── slice ws-reconnect-fix-nbug2: ref ל-transport החי (NBug2 root fix) ───
  /** ref ל-transport הפעיל — נשמר בכל יצירת transport, מנוקה עם #client. */
  #transport: WsAcpTransport | null = null
  /** slice connection-set C2: one id per VM lifetime — SSE header, presence, WS query, DELETE. */
  readonly #connectionId = safeUUID()
  #pageHideReleaseBound = false
  #sessionId: string | null = null
  /**
   * הערך הוא True בין detach() ל-attach() הבא. משתיק
   * שגיאות `WS closed (1005)` מזויפות מאירועי onClose שמופעלים לאחר שהמשתמש
   * התנתק באופן מפורש.
   */
  #detached = false
  /**
   * True בזמן סגירת WS מכוונת בתוך #coldReconnect. מונע מה-onClose הישן
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
  /** True כשה-document.hidden (הדף ברקע). */
  #pageHidden = false
  /** טיימר לניסיון reconnect הבא. */
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined
  /** Guard למניעת שתי לולאות reconnect מקבילות. */
  #reconnecting = false

  // ─── slice session-view-port C3: SessionView patch consumer ───

  /**
   * קורא מ-view.patches ומעדכן bubbles + metadata ב-VM.
   * רץ ברקע (אסינכרוני) ב-loop אינסופיני עד שה-stream נסגר.
   * כל batch patches: עדכון bubbles ביעד (applyPatchMutable) + סינכון metadata.
   */
  async #consumeViewPatches(view: SessionView): Promise<void> {
    const reader = view.patches.getReader()
    // ─── slice empty-session-sync ───
    // סנכרון ראשוני מה-snapshot, **לפני** הלולאה.
    // הסנכרון שבתוך הלולאה מותנה ב-patches, וסשן **חדש** הוא ריק: אין הודעות,
    // ולכן אין reset patch, ולכן `continue` — ו-#syncFromViewState לא נקרא לעולם.
    // התוצאה למשתמשת: אין מוד, אין מודל (configOptions), ואין כפתור תמונה
    // (capabilities) — עד שנטענת היסטוריה שמייצרת patches.
    // ⚠️ זה חייב לרוץ גם כש-view.state ריק — הוא נושא את המטא-דאטה בלי קשר
    // למספר ההודעות.
    this.#syncFromViewState(view.state)
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
        const emission = value ?? { patches: [], updates: [] }
        if (emission.patches.length === 0 && emission.updates.length === 0) continue
        const patches = emission.patches

        // 1. structural reset → bubbles (hydration / SSE-reconnect)
        const resetPatches = patches.filter(
          (p): p is Extract<Patch, { op: "reset" }> => p.op === "reset",
        )
        if (resetPatches.length > 0) {
          applyPatchMutable(this.bubbles, resetPatches, { mapToolContent, mapLocations })
          for (const patch of resetPatches) {
            const next = applyPatch(this.sessionState, patch)
            if (next) this.sessionState = next
          }
          if (attachWindow) {
            attachWindow = false
            const reset = resetPatches[0]
            if (reset) {
              this.#historyMark = historyMarkFromReset(reset.messages)
              this.historyEpoch++
            }
          }
        }

        // 2. other patches → view state only (void for bubbles — same as #drainViewPatches)
        // RemoteSessionView already applied them to view.state in #applyIncoming.

        // 3. all raw wire updates → #onSessionUpdate (WS tee parity)
        for (const update of emission.updates) {
          this.#onSessionUpdate({ update } as unknown as SessionNotification)
        }

        this.#syncFromViewState(view.state)
      }
    } catch {
      // stream נסגר או בוטל — תקין
    } finally {
      try {
        reader.releaseLock()
      } catch {
        /* */
      }
    }
  }

  // ─── slice local-view-wiring C3: קשירה ואימוץ מקומיים (brief §4.3-§4.5) ───

  /**
   * שלב א' — **לפני** יצירת הלקוח (ה-callbacks קופאים ביצירתו — §2.5): משחרר את
   * הקודם (`#localView.dispose()`, לא close — הלקוח משותף), בונה view חדש, **מציב
   * אותו ב-#localView וב-#view מיד** (סוגר את חלון-היתום של attach/loadSession
   * שנכשלים אחריו — §4.5), מפעיל את הניקוז (קורא-ריק — §4.5: patching כפול היה
   * מכפיל בועות), ומחזיר אותו כדי לעטוף ב-tee.
   */
  #bindLocalView(): LocalSessionView {
    this.#localView?.dispose()
    const view = new LocalSessionView({
      cwd: this.cwd ?? "",
      cliKind: this.#cliKind ?? "",
    })
    this.#localView = view
    this.#view = view
    void this.#drainViewPatches(view)
    return view
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
   * הניקוז המקומי — קורא-ריק על view.patches (**לא** #consumeViewPatches): ב-local
   * ה-VM הוא הצרכן היחיד של bubbles (primary handler), והדרינה/סינכרון מ-state
   * של ה-view היו מכפילים בועות ומדרסים quota. lifecycle: dispose/close סוגרים
   * את ה-controller ⇒ read() נפתר done ⇒ הלולאה יוצאת. אין מונה-דור (§4.5 —
   * await read() תלוי אינו ניתן להפקעה מבחוץ).
   */
  async #drainViewPatches(view: SessionView): Promise<void> {
    const reader = view.patches.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (this.#view !== view) break // זהות — view הוחלף/אופס
        void value // קורא-ריק: patches נצרכים כדי למנוע backpressure
      }
    } catch {
      // stream נסגר או בוטל — תקין
    } finally {
      try {
        reader.releaseLock()
      } catch {
        /* */
      }
    }
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
    // title
    if (viewState.title !== this.sessionTitle) this.sessionTitle = viewState.title
    // contextUsage (אופציונלי — אפסר לאמץ ל-UsageUpdate סטרקטורלית)
    if (viewState.contextUsage !== this.contextUsage) {
      this.contextUsage = viewState.contextUsage as typeof this.contextUsage
    }
    // commands
    this.availableCommands = viewState.commands as typeof this.availableCommands
    // modes
    this.modes = viewState.modes as typeof this.modes
    // configOptions
    this.configOptions = viewState.configOptions as typeof this.configOptions
    // quota
    if (viewState.quota !== this.quota) this.quota = viewState.quota
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
    this.#sessionEndListeners.push(cb)
    return () => {
      const i = this.#sessionEndListeners.indexOf(cb)
      if (i >= 0) this.#sessionEndListeners.splice(i, 1)
    }
  }

  #endSessionScope(reason: SessionEndReason): void {
    for (const cb of this.#sessionEndListeners) {
      try {
        cb(reason)
      } catch {
        // one listener must not break teardown
      }
    }
  }

  #remoteViewOpts(): { headers: Record<string, string>; onSseReconnected?: () => void } {
    const headers = { "Acp-Connection-Id": this.#connectionId }
    const listener = this.#sseReconnectedListener
    return listener ? { headers, onSseReconnected: () => listener() } : { headers }
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
   * @internal מזריק transport stub ל-#transport (לטסט DoD#4: closeAndWait נקרא ב-#doReconnect).
   * stub: אובייקט עם closeAndWait spy בלבד — לא WsAcpTransport אמיתי.
   */
  _setTransportForTest(t: { closeAndWait: () => Promise<void> } | null): void {
    this.#transport = t as WsAcpTransport | null
  }
  /**
   * @internal מגדיר #sessionId + cwd + #cliKind ישירות — כדי ש-reconnect() לא יחזור מוקדם.
   */
  _setSessionContextForTest(ctx: { sessionId: string; cwd: string; cliKind: string }): void {
    this.#sessionId = ctx.sessionId
    this.cwd = ctx.cwd
    this.#cliKind = ctx.cliKind
  }
  /**
   * @internal override ל-#findReusableAgent — מחזיר ערך קבוע לטסטים.
   */
  _mockFindReusableAgentForTest(returnValue: string | null): void {
    this.#findReusableAgent = async () => returnValue
  }
  /**
   * @internal override ל-#coldReconnect — זורק/מחזיר ערך קבוע לטסטים.
   */
  _mockColdReconnectForTest(error: Error): void {
    this.#coldReconnect = async () => {
      throw error
    }
  }
  /**
   * @internal override ל-#warmReconnect — מחזיר ערך קבוע לטסטים.
   * אם returnValue=true, גם מקבע status="connected" (כמו #warmReconnect האמיתי).
   * אם returnValue=false, לא מגדיר status (attachToLiveAgent יגדיר "error").
   */
  _mockWarmReconnectForTest(returnValue: boolean): void {
    this.#warmReconnect = async (_agentId: string) => {
      if (returnValue) this.#setStatus("connected")
      return returnValue
    }
  }
  /**
   * @internal override ל-#warmReconnect — מחזיר ערך מ-callback שמקבל את ה-instance.
   * מאפשר לצלם state (#sessionId, cwd) בזמן הקריאה.
   * callback מחזיר true → גם מקבע status="connected".
   */
  _mockWarmReconnectCapturingStateForTest(cb: (session: AgentSession) => boolean): void {
    this.#warmReconnect = async (_agentId: string) => {
      const ok = cb(this)
      if (ok) this.#setStatus("connected")
      return ok
    }
  }
  /**
   * @internal חושף #sessionId לטסטים (לבדיקת הזרקת state).
   */
  _getSessionIdForTest(): string | null {
    return this.#sessionId
  }
  /**
   * @internal קורא ישירות ל-#doReconnect (נתיב ה-auto-reconnect). נדרש כי reconnect()
   * הציבורי חוזר מוקדם כש-#sessionId===null, אז אין נתיב ציבורי לבדוק את ה-guard של #doReconnect.
   */
  _doReconnectForTest(): Promise<void> {
    return this.#doReconnect()
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

  // ─── slice ws-reconnect-infra: reconnect helpers ────────────────────────────

  /**
   * מחפש agent חי בצד השרת שאפשר להתחבר אליו מחדש (warm) במקום spawn.
   * תנאי: אותו acpSessionId (=#sessionId הנוכחי), אותו cwd, ו-status חי.
   * מחזיר agentId או null. שגיאת רשת → null (נופלים ל-cold).
   */
  #findReusableAgent = async (): Promise<string | null> => {
    if (this.#sessionId === null || this.cwd === null) return null
    try {
      const agents = await listAgents()
      const match = agents.find(
        (a) =>
          a.acpSessionId === this.#sessionId &&
          a.cwd === this.cwd &&
          a.status !== "crashed" &&
          a.status !== "closed",
      )
      return match?.id ?? null
    } catch {
      return null // שגיאת רשת — cold יטפל
    }
  }

  // statics ל-reconnect (מוגדרים כאן כדי שכל המתודות שמשתמשות בהן יהיו מוכנות)
  static readonly #MAX_RECONNECT_ATTEMPTS = 5
  /** backoff (ms) לפי ניסיון. סך ~31s — חסר מהסף המומלץ לניסיון reconnect ידני. */
  static readonly #BACKOFF_MS = [1000, 2000, 4000, 8000, 16000]
  static readonly #MED8_RETRY_MS = 250
  static readonly #MED8_MAX_RETRIES = 3
  /**
   * slice reconnect-ws-takeover: קוד close ייעודי — WS זה **הודח** ע"י חיבור חדש לאותו
   * agent (BE ws-agent.ts takeover, §3 architecture diagram). טרמינל: **אין**
   * #scheduleReconnect — אחרת הישן ינסה reconnect ↔ ידיח את החדש בחזרה (ping-pong אינסופי).
   * ⚠️ חייב להתאים ל-TAKEOVER_CODE ב-packages/backend/src/delivery/ws-agent.ts.
   */
  static readonly #TAKEOVER_CLOSE_CODE = 4409

  /**
   * מטפל בסגירת WS לא צפויה (לא detach, לא 1000/1001).
   * רקע → disconnected (ממתין ל-reconnect ידני); פוקוס → backoff אוטומטי.
   */
  async #handleUnexpectedClose(code: number, reason: string): Promise<void> {
    // anti-clobber (slice surface-real-error, Commit 1; הוחלף ל-flag ב-calev-heavy §10.2,
    // Commit 4): אם כבר הוצגה שגיאה טרמינלית (attach/loadSession catch — #cleanup רץ /
    // agent מת) — אל תדרוס אותה ב-"WS closed" הגנרי. switchSession/newSession *לא* מדליקים
    // את הדגל — הם משאירים WS חי, ו-drop מאוחר יותר צריך כן להצית reconnect.
    if (this.#errorSurfaced && this.error) return
    // takeover (slice reconnect-ws-takeover, §4 Commit 1): טרמינלי — WS אחר "ניצח" ומחזיק
    // את ה-agent החי. שים לב: בודקים את זה **לפני** getAgent — אין סיבה לשאול על crash
    // (ה-agent חי וב-attach מאת ה-WS החדש); ואין #scheduleReconnect (מונע ping-pong).
    if (code === AgentSession.#TAKEOVER_CLOSE_CODE) {
      this.error = createI18n({ locale: this.#settings?.locale ?? detectLocale() }).t(
        "session.openedElsewhere",
      )
      this.#setStatus("disconnected")
      return
    }
    // slice ownership-truth C5: 1008 + "session-host-active" — הסוכן תפוס ע"י
    // מסלול אחר (HTTP/session-host). טרמינלי כמו takeover: אין reconnect (הוא
    // לעולם לא יצליח בשלב א'), הצג הודעה מובנתת.
    if (code === 1008 && reason === "session-host-active") {
      this.error = createI18n({ locale: this.#settings?.locale ?? detectLocale() }).t(
        "session.heldByOtherTransport",
      )
      this.#setStatus("disconnected")
      return
    }
    // best-effort crash-path (slice surface-real-error Commit 3): ה-child אולי קרס
    // עם סיבה ידועה (ENOENT/credit/native-binary) — describeCrash ב-BE כותב crashReason.
    // null-guard (אביגיל #1): this.agentId הוא $state<string|null> — getAgent דורש string.
    // בלי agentId אין מה למשוך → fallback מיידי ל-WS closed (בלי network call).
    const info = this.agentId ? await getAgent(this.agentId).catch(() => null) : null
    if (info?.agent.status === "crashed" && info.agent.crashReason) {
      this.error = info.agent.crashReason
    } else {
      // סבב-תיקונים liveness: **אין** יותר `this.error = "WS closed (1006): no reason"`.
      // ניתוק-רשת הוא מצב-חיבור חולף, והבעלים היחיד שלו הוא DisconnectBanner —
      // שיודע להעלם לבד בחזרה. מחרוזת אדומה-קבועה על המסך גם שיקרה (היא נשארה
      // אחרי שהחיבור חזר) וגם דרסה את מקומה של הודעה אמיתית.
      // ⚠️ שלושת הטרמינליים **נשמרים** ב-this.error: crashReason (למעלה),
      // openedElsewhere ו-heldByOtherTransport (מוקדם יותר במתודה) — הם אינם
      // חולפים, אין להם התאוששות אוטומטית, ולמשתמש אין דרך אחרת לדעת עליהם.
      //
      // וכן — **מנקים**, לא רק נמנעים מלכתוב. קודם המחרוזת הגולמית דרסה שגיאה
      // חולפת קודמת (`switchSession failed: …`), וזה היה התפקיד הסמוי שלה. בלי
      // הניקוי היא הייתה נשארת תלויה על המסך לאורך כל הניתוק. טרמינליות מוגנות
      // ממילא ע"י ה-guard של #errorSurfaced בראש המתודה, שכבר החזיר.
      this.error = null
      connWarn("ws-closed", { code, reason: reason || "no reason", agentId: this.agentId })
    }
    if (this.#pageHidden) {
      this.#setStatus("disconnected") // רקע — לא אוטו
      return
    }
    this.#scheduleReconnect() // פוקוס — backoff
  }

  #scheduleReconnect(): void {
    if (this.#reconnecting) return
    this.#reconnecting = true
    this.reconnectAttempt = 0
    this.#setStatus("disconnected")
    void this.#runReconnectLoop()
  }

  async #runReconnectLoop(): Promise<void> {
    while (this.reconnectAttempt < AgentSession.#MAX_RECONNECT_ATTEMPTS) {
      const attempt = this.reconnectAttempt // 0-indexed לתוך BACKOFF_MS
      const delay = AgentSession.#BACKOFF_MS[attempt] ?? 16000
      this.reconnectAttempt = attempt + 1 // 1-indexed לחיווי
      await new Promise<void>((resolve) => {
        this.#reconnectTimer = setTimeout(resolve, delay)
      })
      if (this.#detached) {
        this.#reconnecting = false
        return
      }
      try {
        await this.#doReconnect()
      } catch {
        // warm/cold כבר תפסו; נמשיך
      }
      if (this.status === "connected") {
        this.#reconnecting = false
        this.reconnectAttempt = 0 // הניקוי עצמו ב-#onReconnectSuccess (בתוך #doReconnect)
        return
      }
    }
    this.#reconnecting = false
    this.#setStatus("disconnected") // מיצינו — ממתין ל-reconnect ידני
  }

  #clearReconnectTimer(): void {
    if (this.#reconnectTimer !== undefined) {
      clearTimeout(this.#reconnectTimer)
      this.#reconnectTimer = undefined
    }
  }

  /**
   * ניסיון reconnect יחיד: warm-first, נופל ל-cold בכל כשל.
   *
   * NBug2 root fix: אם יש WS חי (#transport לא null) — סגור אותו והמתן לאישור
   * לפני warm. בלי זה: ה-WS החי נדרס ב-#warmReconnect:289 בלי להיסגר → agent
   * יתום קבוע (BE דוחה WS כפול ב-1008 כש-hasActiveWs=true). ה-BE דוחה WS חדש ב-1008.
   *
   * כשה-WS כבר מת (auto-reconnect): closeAndWait מתרצה מיד (readyState===CLOSED).
   */
  #doReconnect = async (): Promise<void> => {
    // slice http-cold-parity: remote חי — יציאה לפני שומר-ה-#sessionId שלמטה. בלי זה,
    // אימוץ ה-#sessionId (attachRemote) חושף לולאת-backoff ישנה של WS ש"שרדה" באותו
    // טאב (#cleanup אינו מנקה טיימר/#reconnecting, attachRemote מאפס #detached=false)
    // ⇒ #findReusableAgent מוצא את סוכן ה-SessionHost לפי acpSessionId ו-#warmReconnect
    // פותח WS מקביל אל אותו host — "הזרוע הכפולה". בלי #setStatus במכוון:
    // #runReconnectLoop מסתיים לבד כשהוא רואה status==="connected"; disconnected היה
    // מסמן סשן remote חי כמנותק. ר' הבריף §4/Commit 1#5 + §6.
    if (this.#remoteView()) return
    // אין סשן/cwd/cliKind → אין מה לשחזר (מראה את guard של reconnect():649). מונע
    // session/load: null בלולאת auto-reconnect — קורה בטלפון כש-WS נסגר ב-1006 לפני
    // ש-#sessionId נקבע (attach:489 / loadSession:626 קובעים אותו רק בהצלחה).
    if (this.#sessionId === null || this.cwd === null || this.#cliKind === null) {
      this.#reconnecting = false
      this.#setStatus("disconnected")
      return
    }
    // slice reconnect-bubble-merge, תיקון-במקום 2 (calev NO-GO r2 2026-07-22): הקפא
    // כאן — בראש #doReconnect — ולא בתוך #warmReconnect. בניתוק-רשת מוחלט גם
    // #findReusableAgent (listAgents) נכשל → מדלגים על warm לגמרי ונכנסים ישר ל-cold;
    // הקפאה שהייתה רק בתוך #warmReconnect לא כיסתה את הנתיב הזה → coldReconnect איפס
    // את bubbles ל-[] בלי snapshot → המסך התרוקן. כאן זה מכסה warm, warm→cold, וגם
    // cold-ישיר. idempotent — לא דורס snapshot טוב שנשאר מניסיון קודם/backoff.
    if (this.#displaySnapshot === null) this.#displaySnapshot = this.bubbles
    // NBug2 root: סגור WS חי והמתן לאישור לפני warm
    if (this.#transport) {
      await this.#transport.closeAndWait()
      this.#client = null
      this.#transport = null
      // slice-permission-ui-basic: #client התאפס — פתור pending כ-cancelled (הסיכון #1,
      // §4 Commit 2). אחרת בקשת-הרשאה ממתינה נשארת תלויה כש-WS נופל באמצע reconnect.
      this.#resolvePendingPermission({ outcome: { outcome: "cancelled" } })
      // slice-elicitation-ui: אותו דפוס בדיוק — פתור שאלה מובנת ממתינה כ-cancel.
      this.#resolvePendingElicitation({ action: "cancel" })
    }
    const reuseId = await this.#findReusableAgent()
    if (reuseId !== null) {
      const ok = await this.#warmReconnect(reuseId)
      if (ok) {
        this.#onReconnectSuccess()
        return
      }
      // warm נכשל (1008 אחרי retries / שגיאת WS/handshake) → נפילה ל-cold
    }
    await this.#coldReconnect()
    this.#onReconnectSuccess()
  }

  /**
   * חיבור-מחדש שהצליח — ⇒ **כל** שגיאה שנרשמה בדרך מיושנת בהגדרה.
   *
   * סבב-תיקונים liveness: זה השורש של `loadSession failed: Failed to fetch`
   * שנשאר על המסך אחרי שהחיבור התאושש — ניסיון כושל כתב אותה (:1886) וההצלחה
   * שאחריו לא ניקתה. הניקוי יושב כאן, בשתי נקודות-ההצלחה של #doReconnect,
   * ולא בלולאת ה-backoff, כי #doReconnect נקרא גם ישירות (reconnect ידני) —
   * ניקוי בלולאה בלבד היה מחמיץ בדיוק את המסלול שהמשתמשת נתקלה בו.
   */
  #onReconnectSuccess(): void {
    if (this.status !== "connected") return
    this.reconnectAttempt = 0
    this.error = null
    this.#errorSurfaced = false
    connInfo("reconnected", { agentId: this.agentId })
  }

  /**
   * cold: יוצר agent חדש דרך loadSession מאפס.
   * guard 217 זורק אם status==="connecting"||"connected" — אם warm הכשיל ב-connecting,
   * מאפסים ל-disconnected שעובר את ה-guard.
   *
   * ⚠️ NBug1+NBug2 fix: חובה לסגור את #client הישן (close WS) ולמחוק את ה-agentId הקודם
   * לפני שloadSession יוצר agent חדש — אחרת agents מצטברים חיים ב-BE (DoD#16).
   */
  #coldReconnect = async (): Promise<void> => {
    // שמור agentId הקודם לפני שloadSession ידרוס אותו
    const prevAgentId = this.agentId
    this.#tearingDown = true // NBug2: השתק onClose ישן (1005) של ה-WS שאנו סוגרים
    try {
      // סגור את ה-WS/client הישן (NBug2: מנע WS ו-agent תקועים ב-BE)
      try {
        this.#client?.close()
      } catch {
        /* כבר סגור */
      }
      this.#client = null
      this.#transport = null // slice ws-reconnect-fix-nbug2: נקה אחרי סגירה
      // slice-permission-ui-basic: #client התאפס — פתור pending כ-cancelled (הסיכון #1).
      this.#resolvePendingPermission({ outcome: { outcome: "cancelled" } })
      this.#resolvePendingElicitation({ action: "cancel" })
      if (this.status === "connecting" || this.status === "connected") {
        this.#setStatus("disconnected") // מאפס מצב שהשאיר warm-fail; עובר את guard 217
      }
      // defensive: ה-guard ב-#doReconnect כבר מבטיח שאלה לא null, אך לא נשען על ! בלבד
      // (assertion של TS, ללא בדיקת runtime) — אחרת session/load: null ידחה ע"י ה-agent.
      const sid = this.#sessionId,
        cwd = this.cwd,
        cliKind = this.#cliKind
      if (sid === null || cwd === null || cliKind === null) return
      await this.loadSession({ sessionId: sid, cwd, cliKind }, { preserveContextOnError: true })
    } finally {
      this.#tearingDown = false // שחרר אחרי שה-WS החדש פעיל
    }
    // מחק את ה-agent הישן אחרי שloadSession הצליח לייצר חדש (NBug1: מנע agent leak)
    // רק אם ה-agentId השתנה (loadSession קובע agentId חדש; prevAgentId הוא הישן)
    if (prevAgentId && prevAgentId !== this.agentId) {
      void deleteAgent(prevAgentId).catch(() => {})
    }
  }

  /**
   * warm: מתחבר ל-agent קיים (אותו agentId) דרך WS חדש, בלי createAgent.
   * מחקה את הדגם של switchSession (288-336).
   * מטפל ב-MED-8 (1008) עם retry. מחזיר true בהצלחה, false → fallback ל-cold.
   */
  #warmReconnect = async (agentId: string): Promise<boolean> => {
    this.#detached = false
    // slice reconnect-recovery: reset #errorSurfaced (כמו כל נתיב-חיבור אחר —
    // attach:886/loadSession:1189/attachToLiveAgent:1295) — בלי זה, ניסיון warm
    // עתידי שמצליח לא מנקה את הדגל, וguard 601 חוסם שקט auto-reconnect עתידי
    // על סשן בריא (אביגיל r2 🔴).
    this.#errorSurfaced = false
    this.#setStatus("connecting") // ל-warm מותר — לא עובר דרך loadSession של ה-VM

    for (let attempt = 0; attempt <= AgentSession.#MED8_MAX_RETRIES; attempt++) {
      this.#client = null
      this.#transport = null // slice ws-reconnect-fix-nbug2: איפוס iteration (WS החי כבר סגור ב-#doReconnect)
      // slice-permission-ui-basic: #client התאפס — פתור pending כ-cancelled (הסיכון #1).
      // idempotent (no-op בסבבי retry נוספים אחרי שכבר נפתר בסבב הראשון).
      this.#resolvePendingPermission({ outcome: { outcome: "cancelled" } })
      this.#resolvePendingElicitation({ action: "cancel" })
      const transport = new WsAcpTransport(this.#agentWsUrl(agentId))
      this.#transport = transport // slice ws-reconnect-fix-nbug2: שמור ref ל-closeAndWait

      // ⚠️ תיקון אביגיל #1 — DEADLOCK: waitForOpen (ws-transport.ts:70-78) מאזין רק
      // open+error, לא close. סגירת 1008 היא close event → waitForOpen נתקע לנצח.
      // לכן race בין waitForOpen ל-Promise שנפתר ב-onClose.
      const closeOutcome = new Promise<{ closed: true; code: number; reason: string }>(
        (resolve) => {
          transport.onClose((code, reason) => resolve({ closed: true, code, reason }))
        },
      )
      let opened = false
      const closeResult = await Promise.race([
        transport
          .waitForOpen()
          .then(() => {
            opened = true
            return null
          })
          .catch(() => null),
        closeOutcome,
      ])

      if (!opened) {
        // ה-WS נסגר/נכשל לפני open. 1008 = MED-8 (retry); אחר = כשל warm → cold.
        transport.close()
        const code = closeResult && "closed" in closeResult ? closeResult.code : 0
        const reason = closeResult && "closed" in closeResult ? closeResult.reason : ""
        // slice ownership-truth C5: 1008 + "session-host-active" = הסוכן תפוס ע"י
        // מסלול אחר (HTTP/session-host). ניסיון חוזר לעולם לא יצליח בשלב א' — אל תבזבז
        // retries. הצג הודעה מובנת וצא (לא cold — אין טעם לנסות cold גם).
        if (code === 1008 && reason === "session-host-active") {
          this.error = createI18n({ locale: this.#settings?.locale ?? detectLocale() }).t(
            "session.heldByOtherTransport",
          )
          this.#setStatus("disconnected")
          return false
        }
        if (code === 1008 && attempt < AgentSession.#MED8_MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, AgentSession.#MED8_RETRY_MS))
          continue // MED-8 — נסה שוב
        }
        return false // לא-1008, או מיצינו retries → cold
      }

      // ה-WS פתוח. רשום onClose "אמיתי" לנפילות עתידיות.
      transport.onClose((code, reason) => {
        if (this.#detached) return
        if (this.#tearingDown) return // NBug2: סגירה מכוונת ב-cold — אל תצית reconnect
        if (code !== 1000 && code !== 1001) void this.#handleUnexpectedClose(code, reason)
      })

      try {
        this.agentId = agentId
        // slice local-view-wiring C3: bind **פר-לקוח** — בתוך לולאת ה-retry, לפני
        // כל createAttachedAcpClient (§4.3). כל סיבוב משחרר את ה-view של הסיבוב הקודם
        // (dispose). warm מדלג על initialize בכוונה (באג Codex "Already initialized").
        const localView = this.#bindLocalView()
        this.#client = createAttachedAcpClient(
          transport,
          teeAcpCallbacks(
            {
              onUpdate: this.#onSessionUpdate,
              onExtNotification: this.#onExtNotification,
              onRequestPermission: this.#onRequestPermission,
              onCreateElicitation: this.#onCreateElicitation,
            },
            localView.observerCallbacks,
          ),
          { capabilities: ATTACHED_CAPS_FALLBACK },
        )
        this.#ext = createExtClient(this.#client)
        // slice local-view-wiring C3 — נקודת-אימוץ 3: sessionId ידוע (this.#sessionId),
        // מיד אחרי יצירת הלקוח ולפני ה-try של ה-replay.
        this.#adoptLocalView(this.#client, this.#sessionId!)
        // slice reconnect-bubble-merge, תיקון-במקום 2: ההקפאה עצמה עברה לקריאה
        // (#doReconnect / attachToLiveAgent) — לא כאן. #warmReconnect לבדו לא מכסה
        // ניתוק-רשת מוחלט שמדלג עליו לגמרי (ר' calev NO-GO r2 2026-07-22).
        this.bubbles = []
        this.isLoadingHistory = true
        try {
          const m = this.#sessionMeta()
          const loadResult = await this.#client.loadSession({
            sessionId: this.#sessionId!,
            cwd: this.cwd!,
            mcpServers: [],
            ...(m && { _meta: m }),
          })
          this.#captureSessionConfig(loadResult)
        } finally {
          this.isLoadingHistory = false
          this.#setTurnState("idle") // replay מסתיים — reset turnState (replay אינו תור). מתאם ל-loadSession/switchSession; בלעדיו אינדיקטור "המודל פועל" נתקע אחרי warm-reconnect (ה-turn-tracker observe על frames משוחזרים)
          // הערה: אין שחרור snapshot כאן — זה רץ גם בכשל (throw). השחרור עצמו קורה
          // רק בהצלחה, ב-#setStatus (chokepoint משותף ל-warm/cold — ר' שם).
        }
        // replace:true — אותו דגם כמו switchSession:327 (fix-409 מוזג ב-8f59ec3)
        await notifySessionAttached(agentId, this.#sessionId!, { replace: true }).catch(() => {})
        this.#setStatus("connected")
        return true
      } catch {
        // שגיאת handshake/loadSession — נקה ונפול ל-cold
        this.#client = null
        this.#transport = null // slice ws-reconnect-fix-nbug2: נקה אחרי כשל warm
        // slice-permission-ui-basic: כיסוי-קצה — אם requestPermission הגיע במהלך הניסיון
        // הכושל הזה (בין יצירת #client ל-throw), ו-זה הניסיון האחרון בלולאה (אין
        // top-of-loop הבא שיפתור), חובה לפתור כאן כדי לא להשאיר Promise תלוי.
        this.#resolvePendingPermission({ outcome: { outcome: "cancelled" } })
        this.#resolvePendingElicitation({ action: "cancel" })
        // ─── slice local-view-wiring, תיקון-במקום (calev ממצא 3 · freebuff ממצא 1) ───
        // ⚠️ הסיבוב הזה כבר קרא #bindLocalView (פתח patch-stream + drain) ו-#adoptLocalView.
        // בלי שחרור כאן, ה-controller לא נסגר, ה-drain נתקע על read() **לנצח**,
        // וה-view מחזיק מצביע ללקוח מת.
        // #doReconnect מסתיר את זה (נופל ל-cold → loadSession → #bindLocalView שמשחרר),
        // אבל **ל-attachToLiveAgent אין fallback קר** — שם הדליפה שורדת עד detach.
        // dispose ולא close: הלקוח משותף (§4.2). כאן הוא ממילא מת, אבל הכלל אחיד.
        this.#localView?.dispose()
        this.#localView = null
        this.#view = null
        transport.close()
        return false
      }
    }
    return false
  }

  // ─── מחזור חיי חיבור (connection lifecycle) ─────────────────────────

  /**
   * יצירת סוכן חדש עבור (cwd, cliKind), פתיחת WS, לחיצת יד של ACP, ורישום
   * של מאזין להתראות. לאחר ההשלמה, הסשן מוכן עבור sendPrompt.
   */
  attach = async (input: {
    cwd: string
    cliKind: string
    // slice project-system-prompt: פרומפט-מערכת פר-פרויקט. הקורא (action connectAgent)
    // שולף אותו מ-Settings לפי cwd — ה-VM עצמו לא מחזיק Settings (שכבתיות, §9 Q1).
    systemPrompt?: string | null
  }): Promise<void> => {
    if (this.status === "connecting" || this.status === "connected") {
      throw new Error(`cannot attach in status ${this.status}`)
    }
    this.#setStatus("connecting")
    this.error = null
    this.authMethods = [] // slice auth-guidance: נקה לפני חיבור חדש — נלכד מחדש אחרי createAcpClient
    this.#errorSurfaced = false // calev-heavy §10.2: סשן חדש לא יורש כשל טרמינלי קודם
    this.bubbles = []
    this.#detached = false

    try {
      // 1. צור סוכן בצד השרת (BE)
      const { agentId } = await createAgent({
        cwd: input.cwd,
        cliKind: input.cliKind,
        systemPrompt: input.systemPrompt,
      })
      this.agentId = agentId
      this.cwd = input.cwd
      this.#cliKind = input.cliKind // slice ws-reconnect-infra: שמור ל-cold reconnect

      // 2. פתח תעבורת WS
      const transport = new WsAcpTransport(this.#agentWsUrl(agentId))
      this.#transport = transport // slice ws-reconnect-fix-nbug2: שמור ref ל-closeAndWait
      transport.onClose((code, reason) => {
        if (this.#detached) return
        if (this.#tearingDown) return // NBug2: סגירה מכוונת ב-cold — אל תצית reconnect
        if (code !== 1000 && code !== 1001) {
          void this.#handleUnexpectedClose(code, reason)
        }
      })
      await transport.waitForOpen()

      // 3. לחיצת יד של ACP + סשן חדש
      // slice local-view-wiring C3: ה-view חייב להתקיים **לפני** createAcpClient
      // (ה-callbacks קופאים ביצירתו) וה-sessionId מגיע אחריה — שני שלבים: bind+tee כאן,
      // adopt אחרי newSession (§4.3).
      const localView = this.#bindLocalView()
      this.#client = await createAcpClient(
        transport,
        teeAcpCallbacks(
          {
            onUpdate: this.#onSessionUpdate,
            onExtNotification: this.#onExtNotification,
            onRequestPermission: this.#onRequestPermission,
            onCreateElicitation: this.#onCreateElicitation,
          },
          localView.observerCallbacks,
        ),
      )
      this.authMethods = this.#client.authMethods // slice auth-guidance: ללכידה בכשל session/new/prompt מאוחר יותר
      this.#ext = createExtClient(this.#client)
      const m = this.#sessionMeta()
      const sessionResult = await this.#client.newSession({
        cwd: input.cwd,
        mcpServers: [],
        ...(m && { _meta: m }),
      })
      this.#sessionId = (sessionResult as { sessionId?: string }).sessionId ?? null
      if (!this.#sessionId) {
        throw new Error("newSession returned no sessionId")
      }
      // slice local-view-wiring C3 — נקודת-אימוץ 1: אחרי newSession (sessionId מהתשובה;
      // אין היסטוריה לאבד — §4.4) ולפני captureSessionConfig (שמאפס שדות VM, לא state-view).
      this.#adoptLocalView(this.#client, this.#sessionId)
      this.#captureSessionConfig(sessionResult) // slice 23: לכוד config מה-session

      // 4. תגיד ל-BE לאיזה sessionId התחברנו (מאמץ מיטבי - best-effort)
      await notifySessionAttached(agentId, this.#sessionId).catch(() => {})

      this.#setStatus("connected")
      // ─── slice-restore-last-config: החל בחירות אחרונות (אחרי connected — חובה) ───
      await this.#applyRememberedConfig()
    } catch (e) {
      this.error = formatAcpError(e)
      this.#errorSurfaced = true // calev-heavy §10.2: כשל טרמינלי — #cleanup הורג את ה-WS
      this.#setStatus("error")
      this.#cleanup()
    }
  }

  // ─── slice view-switch C3-א: attachRemote — נפרד מ-attach (attach הוא ~250 שורות WS/reconnect) ───

  /**
   * חיבור במצב remote: POST /api/agents (HTTP בלבד) + createRemoteView (SSE) —
   * ❌ אין WsAcpTransport/#client/#transport, ❌ אין #scheduleReconnect (ר' ממצא 5:
   * ProviderConnection נוצר ביצירת הסוכן; getOrCreateHost בונה AcpClient משלו על
   * אותו connection — פתיחת WS מקביל ל-SessionHost הייתה "הזרוע הכפולה").
   */
  attachRemote = async (input: {
    cwd: string
    cliKind: string
    systemPrompt?: string | null
  }): Promise<void> => {
    // 0. ⚠️⚠️ קודם guard-הכפילות, ורק אחריו #cleanup() — הסדר ההפוך הוא באג הרסני
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
    this.#detached = false
    this.#answeredPermissionId = null
    this.#answeredElicitationId = null

    // 2. #setStatus מנגן cue ומאפס #displaySnapshot — לא השמה ישירה. + cwd/cliKind כמו attach
    // (בלעדיהם: שם הפרויקט/CLI בצ'אט, fallback ל-newSession, ו-#sessionMeta() נשברים)
    this.#setStatus("connecting")
    this.cwd = input.cwd
    this.#cliKind = input.cliKind

    let attached = false
    try {
      // 3. HTTP בלבד. מיד אחריו: agentId מוצב — #cleanup מוחק לפיו; אם ההשמה נדחית
      // לשלב 6, כשל-מהיר (שלב 5) וה-catch (שלב 8) קוראים #cleanup() בלי מה למחוק,
      // וה-agent+host+child שנוצרו כאן מדליפים.
      const { agentId } = await createAgent({
        cwd: input.cwd,
        cliKind: input.cliKind,
        systemPrompt: input.systemPrompt,
      })
      this.agentId = agentId

      // 4.
      const view = await createRemoteView({ agentId, ...this.#remoteViewOpts() })

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
      this.#sessionId = view.state.sessionId

      // 6.
      this.#view = view
      this.#isRemote = true // slice local-view-wiring C1: view של remote מוצב כאן
      void this.#consumeViewPatches(view)
      this.#setStatus("connected")
      attached = true
      // 7. ❌ אין WsAcpTransport/#client/#transport, ❌ אין #scheduleReconnect
    } catch (e) {
      // 8. כל שלבים 3-6 עטופים — createAgent/connect() שנדחים לא ישאירו status="connecting" לנצח
      this.#cleanup()
      this.error = formatAcpError(e)
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

  /**
   * חיבור-מחדש במצב remote לסוכן **חי** (warm reconnect מהפאנל): שלבי attachRemote
   * פחות createAgent — ה-host כבר קיים ב-BE (נוצר ב-attachRemote המקורי), ו-getOrCreateHost
   * מחזיר אותו בלי ליצור סשן חדש. מקור-האמת ל-sessionId הוא ה-snapshot (frame-zero של
   * GET /events), לא agent.acpSessionId מהפאנל (עלול להיות ישן). ❌ בלי WS, ❌ בלי
   * createAgent, ❌ בלי notifySessionAttached (ה-BE הוא הבעלים — דווח ב-C1).
   * הערה: this.#sessionId נשאר null — עקבי עם attachRemote (נתיבי WS חסומים ב-#view
   * ו-reconnect() ממילא early-return); זו התנהגות צפויה, לא באג.
   */
  attachRemoteToLiveAgent = async (input: {
    agentId: string
    cwd: string
    cliKind: string
  }): Promise<void> => {
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
    this.#detached = false
    this.#answeredPermissionId = null
    this.#answeredElicitationId = null

    // 2. #setStatus מנגן cue ומאפס #displaySnapshot. agentId/cwd/cliKind מ-input
    // (agentId מוצב לפני ה-try — #cleanup בכשל מוחק לפיו; כאן בלי keepContext).
    this.#setStatus("connecting")
    this.agentId = input.agentId
    this.cwd = input.cwd
    this.#cliKind = input.cliKind

    try {
      // 3. ללא createAgent — ה-host קיים ב-BE. createRemoteView כבר קורא connect()
      // בעצמו (memoized, M8); החתימה מקבלת אובייקט opts (התקדים attachRemote:1204).
      const view = await createRemoteView({ agentId: input.agentId, ...this.#remoteViewOpts() })

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

      // ─── slice http-state-gaps C4: #sessionId מהסנאפשוט ───
      // ⚠️ המתודה קראה את view.state.sessionId לכשל-המהיר אך **לא השימה אותו**.
      // ⇒ אחרי חזרה לסוכן חי, #sessionId נשאר null, וכל מה שמותנה בו מת בשקט —
      // refreshQuota יוצא בשורה הראשונה ולעולם לא מרענן. נמדד, לא הונח.
      // שאר מסלולי ה-remote (attachToLiveAgent :1767, switchSession :1813,
      // newSession :1921) כן משימים; זה היה החריג.
      this.#sessionId = view.state.sessionId

      // 5. #consumeViewPatches מכמת בזהות (this.#view !== view → break) — כמו attachRemote.
      this.#view = view
      this.#isRemote = true // slice local-view-wiring C1: view של remote מוצב כאן
      void this.#consumeViewPatches(view)

      // 6.
      this.#setStatus("connected")
      // 7. ❌ אין WsAcpTransport/#client/#transport, ❌ אין #scheduleReconnect
    } catch (e) {
      // 8. כל השלבים עטופים — כשל לא משאיר status:"connecting" לנצח. keepAgent:true —
      // ר' שלב 4: הסוכן החי ב-BE שורד גם כשל-חולף (רשת/503), המשתמשת יכולה לנסות שוב.
      this.#cleanup({ keepAgent: true })
      this.error = formatAcpError(e)
      this.#errorSurfaced = true
      this.#setStatus("error")
    }
  }

  detach = (): void => {
    this.#detachWith("detach")
  }

  #detachWith(reason: SessionEndReason): void {
    this.#endSessionScope(reason)
    this.#detached = true // ‏לפני ה-cleanup — ‏ה-WS close fires async
    // ─── slice ws-reconnect-infra: ביטול לולאת reconnect ───
    this.#clearReconnectTimer()
    this.#reconnecting = false
    this.reconnectAttempt = 0
    this.#cleanup()
    this.#setStatus("idle")
    this.error = null
    this.bubbles = []
    // ─── slice sessions-inline: ניקוי cache סשנים ───
    this.sessions = []
    this.#sessionsLoaded = false
    this.sessionsError = null
  }

  /** יציאה מהסשן בלי להרוג את הסוכן ב-BE — ה-child שורד (ws-agent.ts:126),
   *  ה-WS נסגר, ה-VM מתאפס ל-idle. מאפשר reconnect/חזרה דרך רשימת-התהליכים.
   *  ⚠️ סנכרן גוף זה מול detach() אם detach() משתנה. הבדלים מ-detach: cleanup({keepAgent:true})
   *  + flush של permission ה-pending לפני הסגירה (למטה). */
  leaveRunning = async (): Promise<void> => {
    this.#endSessionScope("leave-running")
    this.#detached = true
    this.#clearReconnectTimer()
    this.#reconnecting = false
    this.reconnectAttempt = 0
    // slice-permission-ui-basic fix (calev NO-GO — "יציאה בלי כיבוי" תקעה את הסוכן):
    // ב-keepAgent ה-agent שורד וממתין לתשובת permission. חייבים למסור לו cancelled *לפני*
    // סגירת ה-WS. #resolvePendingPermission פותר את ה-Promise, אבל השליחה בפועל היא microtask;
    // setTimeout(0) (macrotask) נותן ל-ws.send לרוץ בזמן שה-WS עוד פתוח, ואז #cleanup סוגר.
    // (detach לא נפגע — הוא הורג את ה-agent, אין מי שממתין.)
    // slice-elicitation-ui: אותו טיפול גם ל-elicitation ה-pending — ה-agent ששרד ממתין
    // לתשובת unstable_createElicitation; חייבים למסור לו cancel לפני סגירת ה-WS.
    if (this.pendingPermission || this.pendingElicitation) {
      this.#resolvePendingPermission({ outcome: { outcome: "cancelled" } })
      this.#resolvePendingElicitation({ action: "cancel" })
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    // ─── slice view-switch C3-ה2: ב-remote, leaveRunning = detach מלא ───
    // keepAgent:true היה מותיר agent+SessionHost+child חיים בלי בעלים ובלי דרך לחזור
    // אליהם מהנתיב המרוחק (אין attachToLiveAgent ל-remote — חסום, ר' C3-ה). known-gap:
    // "השארת סוכן רץ" אינה נתמכת ב-remote ב-S6 (מתועד ב-runbook C4).
    // ─── slice http-usable C2: unify — keepAgent on both transports ───────────
    // Reported bug: leaving without shutdown actually closed the session. The old
    // remote branch called #cleanup(), i.e. killed the agent. The original reason
    // (view-switch C3) was valid then: there was no way back to a remote agent, so
    // keepAgent would orphan it. attachRemoteToLiveAgent now returns to it, and
    // phase B2 added eviction. The host stays registered on purpose (lifecycle
    // decision A) — it does not leak a second ACP client, and returning is simple.
    // unregisterHost alone would have been unsafe.
    //
    // הנימוק המקורי (view-switch C3-ה2) היה נכון בזמנו: לא הייתה דרך לחזור
    // לסוכן מרוחק, אז keepAgent היה מייתם אותו. **זה כבר לא נכון** —
    // attachRemoteToLiveAgent מחזיר אליו, ושלב ב2 נתן את הפינוי.
    //
    // ה-host נשאר רשום בכוונה (הכרעת lifecycle, גישה א) — הוא אינו מדליף
    // לקוח ACP שני, והחזרה אליו פשוטה. unregisterHost לבדו היה מסוכן.
    this.#cleanup({ keepAgent: true })
    this.#setStatus("idle")
    this.error = null
    this.bubbles = []
    // ─── slice sessions-inline: ניקוי cache סשנים ───
    this.sessions = []
    this.#sessionsLoaded = false
    this.sessionsError = null
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
   * loadSession, #warmReconnect). מוחזר Promise שנפתר כש-resolvePermission/cancelPermission
   * נקראים, או כש-#client מתאפס (כל נקודות ה-teardown — ר' #resolvePendingPermission).
   */
  #onRequestPermission = (params: PermissionParams): Promise<PermissionResponse> => {
    return new Promise<PermissionResponse>((resolve) => {
      // pending יחיד — בקשה שנייה סוגרת את הקודמת כ-cancelled (החלטת המשתמשת, §4 Commit 2).
      if (this.pendingPermission) {
        this.#resolvePendingPermission({ outcome: { outcome: "cancelled" } })
      }
      // הגנה: bypass לא אמור לשלוח בקשת הרשאה כלל (הסוכן עוקף) — אך אם בכל זאת הגיעה
      // (race/CLI לא-סטנדרטי), auto-allow כדי לא לתקוע turn בלי UI רלוונטי.
      if (this.bypassActive) {
        const byKind = (k: string) => params.options.find((o) => o.kind === k)
        const chosen = byKind("allow_once") ?? byKind("allow_always") ?? params.options[0]
        resolve(
          chosen
            ? { outcome: { outcome: "selected", optionId: chosen.optionId } }
            : { outcome: { outcome: "cancelled" } },
        )
        return
      }
      this.pendingPermission = { params, resolve }
    })
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
   * #doReconnect/#coldReconnect/#warmReconnect (3 נתיבי reconnect).
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
   * loadSession, #warmReconnect). מוחזר Promise שנפתר כש-resolveElicitation/cancelElicitation
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
   * #doReconnect/#coldReconnect/#warmReconnect (3 נתיבי reconnect).
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
      this.bubbles.push(userBubble)
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
    },
    // slice reconnect-recovery: preserveContextOnError — רק #coldReconnect מעביר true.
    // בטעינה-ראשונית/switchSession/newSession (בלי opts) — התנהגות ללא שינוי (#cleanup מלא).
    opts?: { preserveContextOnError?: boolean },
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
    this.bubbles = []
    this.#detached = false

    // ─── DEV-only: mock session (sessionId "mock:<name>") ───
    // זורם updates גולמיים מ-fixture דרך אותו #onSessionUpdate כמו ACP חי —
    // ללא createAgent/WS/ACP. כלי דיבוג עיצוב; tree-shaken מ-prod build.
    if (import.meta.env.MODE !== "production" && input.sessionId.startsWith("mock:")) {
      await this.#loadMockSession(input.sessionId.slice("mock:".length), input.cwd)
      return
    }

    this.#resetTurnTracking() // NBug3: תור קודם השאיר #turnEnded=true + timer יתום

    try {
      // 1. צור סוכן בצד השרת (זהה ל-attach)
      const { agentId } = await createAgent({ cwd: input.cwd, cliKind: input.cliKind })
      this.agentId = agentId
      this.cwd = input.cwd
      this.#cliKind = input.cliKind // slice ws-reconnect-infra: שמור ל-cold reconnect

      // 2. פתח תעבורת WS + הוסף מאזין onClose (זהה ל-attach)
      const transport = new WsAcpTransport(this.#agentWsUrl(agentId))
      this.#transport = transport // slice ws-reconnect-fix-nbug2: שמור ref ל-closeAndWait
      transport.onClose((code, reason) => {
        if (this.#detached) return
        if (this.#tearingDown) return // NBug2: סגירה מכוונת ב-cold — אל תצית reconnect
        if (code !== 1000 && code !== 1001) {
          void this.#handleUnexpectedClose(code, reason)
        }
      })
      await transport.waitForOpen()

      // 3. לחיצת יד של ACP (זהה ל-attach)
      // slice local-view-wiring C3: bind+tee לפני יצירת הלקוח; adopt **לפני** loadSession —
      // ההיסטוריה המשוחזרת מגיעה תוך כדי ה-await, ואימוץ אחריו מוחק אותה (§2.6/§4.4).
      const localView = this.#bindLocalView()
      this.#client = await createAcpClient(
        transport,
        teeAcpCallbacks(
          {
            onUpdate: this.#onSessionUpdate,
            onExtNotification: this.#onExtNotification,
            onRequestPermission: this.#onRequestPermission,
            onCreateElicitation: this.#onCreateElicitation,
          },
          localView.observerCallbacks,
        ),
      )
      this.authMethods = this.#client.authMethods // slice auth-guidance: ללכידה בכשל loadSession/prompt מאוחר יותר
      this.#ext = createExtClient(this.#client)
      // slice local-view-wiring C3 — נקודת-אימוץ 2: sessionId ידוע (input.sessionId),
      // מיד אחרי יצירת הלקוח ולפני ה-try של ה-replay.
      this.#adoptLocalView(this.#client, input.sessionId)

      // ── קריאה ל-loadSession במקום ל-newSession ──
      // השתק את ה-TTS של ה-Speaker במהלך ניגון מחדש של ההיסטוריה (slice 4: replay-quiet).
      this.isLoadingHistory = true
      try {
        const m = this.#sessionMeta()
        const loadResult = await this.#client.loadSession({
          sessionId: input.sessionId,
          cwd: input.cwd,
          mcpServers: [],
          ...(m && { _meta: m }),
        })
        this.#captureSessionConfig(loadResult) // slice 23: לכוד config (sessionId מ-input, לא מ-response)
      } finally {
        this.isLoadingHistory = false
        this.#setTurnState("idle") // NBug3: replay מסתיים — reset turnState (replay אינו תור)
      }
      this.#sessionId = input.sessionId
      this.sessionTitle = input.title ?? this.sessionTitle // keep-on-undefined: reconnect לא מאפס
      this.#pushTitleToServer(this.sessionTitle) // slice session-title-in-process-list

      // 4. הודע ל-BE (זהה ל-attach, מאמץ מיטבי)
      await notifySessionAttached(agentId, this.#sessionId).catch(() => {})

      this.#setStatus("connected")
    } catch (e) {
      this.error = `loadSession failed: ${formatAcpError(e)}`
      this.#setTurnState("idle") // NBug3: throw מוקדם (createAgent/waitForOpen) — ה-finally הפנימי לא רץ
      // slice reconnect-recovery: נתיב-השימור (cold-reconnect שנכשל) — לא #cleanup() מלא
      // (שהיה מוחק #sessionId/agentId ותוקע את reconnect() ב-early-return). שומר את
      // הקשר-הסשן כדי שלחיצת reconnect הבאה תמצא #sessionId ותנסה שוב (§3 diagram).
      if (opts?.preserveContextOnError) {
        this.#errorSurfaced = true // חובה: ה-WS close אסינכרוני ורץ *אחרי* ש-#coldReconnect
        // מאפס #tearingDown=false → guard 601 (#errorSurfaced) הוא מה שמונע clobber+
        // auto-reconnect על ה-async close (אביגיל r3 🔴).
        this.#cleanup({ keepContext: true }) // teardown מלא (pending/#ext/#client/#transport) — בלי לאפס #sessionId/agentId
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
    this.#clearReconnectTimer()
    this.#reconnecting = false
    this.reconnectAttempt = 0
    await this.#doReconnect()
  }

  // ─── slice reconnect-warm-attach: חיבור מחדש ל-agent חי מהווידג'ט ─── (תוספתי)

  /**
   * חיבור-מחדש ל-agent חי קיים בצד-השרת (warm-attach), מ-state נקי (מהווידג'ט).
   * שונה מ-reconnect(): מקבל את ה-agentId/sessionId/cwd/cliKind מבחוץ (ה-VM לא מחזיק
   * אותם אחרי refresh). מזריק אותם וקורא ל-#warmReconnect הקיים (WS לאותו agentId +
   * session/load על ה-process החי + MED-8). אם warm נכשל — שגיאה (לא cold-spawn, כי
   * cold ייכשל על session שה-CLI לא persisted).
   */
  attachToLiveAgent = async (input: {
    agentId: string
    sessionId: string
    cwd: string
    cliKind: string
  }): Promise<void> => {
    // ─── slice view-switch C3-ה: המסוכן מבין ארבעתן — פותח WS בלי שום שמירה על status/#view ───
    // ⇒ ב-remote אפשר היה להגיע ל-WS מקביל ל-SessionHost על אותו wire (ממצא 5).
    if (this.#remoteView()) return
    this.error = null // אביגיל: #warmReconnect מאפס bubbles אך לא error — נקה כדי
    // שלא יישאר error ישן אחרי re-attach מוצלח.
    this.#errorSurfaced = false // calev-heavy §10.2: סשן חדש לא יורש כשל טרמינלי קודם
    // דפנסיבי: סגור חיבור קיים (אם המשתמש כבר מחובר ל-agent אחר)
    if (this.#transport) {
      await this.#transport.closeAndWait()
      this.#client = null
      this.#transport = null
      // slice-permission-ui-basic: #client התאפס — פתור pending כ-cancelled (הסיכון #1).
      // אותו דפוס בדיוק כמו #doReconnect (סגירת transport חי לפני reconnect).
      this.#resolvePendingPermission({ outcome: { outcome: "cancelled" } })
      this.#resolvePendingElicitation({ action: "cancel" })
    }
    this.#sessionId = input.sessionId
    this.cwd = input.cwd
    this.#cliKind = input.cliKind
    this.sessionTitle = "" // slice session-title: process חי בלי title → fallback ל-"drive-coding"
    // slice reconnect-bubble-merge, תיקון-במקום 2: מסלול-attach הזה קורא ל-#warmReconnect
    // ישירות, בלי לעבור דרך #doReconnect — לכן ההקפאה (שעברה לראש #doReconnect) לא
    // הייתה מכסה אותו. הקפא גם כאן (idempotent, כמו ב-#doReconnect).
    if (this.#displaySnapshot === null) this.#displaySnapshot = this.bubbles
    const ok = await this.#warmReconnect(input.agentId)
    if (!ok) {
      this.error = "reconnect failed: agent no longer available"
      this.#setStatus("error")
    }
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
        this.#sessionId = input.sessionId
        // Parity with the local success path: cwd + title (the BE reset preserves
        // the old title — without this assignment session A's title would stay)
        // + push to the server.
        this.cwd = input.cwd
        this.sessionTitle = input.title ?? this.sessionTitle // keep-on-undefined
        this.#pushTitleToServer(this.sessionTitle)
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
    this.bubbles = []

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
      this.#sessionId = input.sessionId
      this.cwd = input.cwd
      this.sessionTitle = input.title ?? this.sessionTitle // keep-on-undefined
      this.#pushTitleToServer(this.sessionTitle) // slice session-title-in-process-list

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
      this.sessionTitle = ""
      this.isLoadingHistory = true
      try {
        await remoteView.newSession(cwd)
        const newId = remoteView.state.sessionId
        if (!newId) throw new Error("newSession returned no sessionId")
        this.#sessionId = newId
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
    this.bubbles = []
    this.sessionTitle = "" // slice session-title: סשן חדש = אין כותרת

    try {
      const m = this.#sessionMeta()
      const result = await this.#client.newSession({
        cwd,
        mcpServers: [],
        ...(m && { _meta: m }),
      })
      const newId = (result as { sessionId?: string }).sessionId ?? null
      if (!newId) throw new Error("newSession returned no sessionId")
      this.#sessionId = newId
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
    if (this.status !== "connected") return
    // ─── slice view-switch C3-ד: guard view-aware — אחרת כל נתיב ה-config ב-remote no-op שקט ───
    if (!this.#remoteView() && (!this.#client || !this.#sessionId)) return
    let applied: boolean
    const remoteView = this.#remoteView()
    if (remoteView) {
      // ⚠️ ה-UI שולח ids סינתטיים ("mode"/"model") — שקילות ל-local חייבת לחקות את
      // שלושת השלבים של #applyConfigToClient, לא רק את ה-fallback האחרון.
      const byId = this.configOptions.find((o) => o.id === configId)
      // חיפוש-קטגוריה — רק "mode"/"model", ורק כש-value הוא string (כמו local)
      const byCat =
        !byId && typeof value === "string" && (configId === "mode" || configId === "model")
          ? this.configOptions.find((o) => o.category === configId)
          : undefined
      const opt = byId ?? byCat
      if (opt) {
        await remoteView.setConfigOption(opt.id, value)
        applied = true
      } else if (configId === "mode" && typeof value === "string") {
        await remoteView.setMode(value)
        applied = true
      } else if (configId === "model" && typeof value === "string") {
        await remoteView.setSessionModel(value)
        applied = true
      } else {
        // ⚠️ כמו local: לא נמצא = skip בשקט
        applied = false
      }
      // ⚠️ ב-local #applyConfigToClient מעדכן ידנית גם this.modes/this.models מתשובת
      // ה-RPC. ב-remote אין תשובה כזו — יתעדכנו רק כשיגיע *_update מה-wire. known-gap
      // מתועד (runbook C4) — ❌ אל תזייף עדכון מקומי.
    } else {
      applied = await this.#applyConfigToClient(configId, value)
    }
    const cli = this.#cliKind
    if (applied && this.#settings && cli) {
      this.#settings.setLastConfig(cli, configId, value)
    }
  }

  /**
   * הגוף הפנימי של apply. מחזיר true בכל מסלול-הצלחה, false אם configId לא נמצא.
   * מניח ש-guard (status, #client, #sessionId) כבר עבר בקורא.
   */
  #applyConfigToClient = async (configId: string, value: string | boolean): Promise<boolean> => {
    // מסלול 1: option קיים ב-configOptions לפי id
    const optById = this.configOptions.find((o) => o.id === configId)
    if (optById) {
      const res = await this.#client!.setSessionConfigOption({
        sessionId: this.#sessionId!,
        configId,
        value,
      })
      this.configOptions = res.configOptions
      return true
    }

    // מסלול 2: fallback key "model"/"mode" — חפש לפי category
    if (configId === "model" && typeof value === "string") {
      const byCat = this.configOptions.find((o) => o.category === "model")
      if (byCat) {
        const res = await this.#client!.setSessionConfigOption({
          sessionId: this.#sessionId!,
          configId: byCat.id,
          value,
        })
        this.configOptions = res.configOptions
        return true
      }
      // fallback — setSessionModel ישיר; עדכן models ידנית למניעת UI desync
      await this.#client!.setSessionModel({ sessionId: this.#sessionId!, modelId: value })
      if (this.models) this.models = { ...this.models, currentModelId: value }
      return true
    }
    if (configId === "mode" && typeof value === "string") {
      const byCat = this.configOptions.find((o) => o.category === "mode")
      if (byCat) {
        const res = await this.#client!.setSessionConfigOption({
          sessionId: this.#sessionId!,
          configId: byCat.id,
          value,
        })
        this.configOptions = res.configOptions
        return true
      }
      // fallback — setSessionMode ישיר; עדכן modes ידנית
      await this.#client!.setSessionMode({ sessionId: this.#sessionId!, modeId: value })
      if (this.modes) this.modes = { ...this.modes, currentModeId: value }
      return true
    }

    // מסלול 3: לא נמצא — skip בשקט
    console.warn(`[AgentSession] configId "${configId}" not available — skipping`)
    return false
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
      this.quotaLoading = false
      return
    }

    if (this.#quotaFetchInFlight) {
      await this.#quotaFetchInFlight
      return
    }

    this.quotaLoading = true
    const fetchPromise = this.#doRefreshQuota(sessionId).finally(() => {
      this.#quotaFetchInFlight = null
    })
    this.#quotaFetchInFlight = fetchPromise
    await fetchPromise
  }

  /** מבצע את בקשת ה-quota בפועל, עם guard נגד כתיבה אחרי session switch/cleanup. */
  #doRefreshQuota = async (sessionId: string): Promise<void> => {
    try {
      // DEV-only mock harness — אותו תנאי כמו ה-mock loader הקיים (brief §4 Commit 4).
      if (
        import.meta.env.MODE !== "production" &&
        sessionId.startsWith("mock:") &&
        this.#mockQuota !== undefined
      ) {
        if (this.#sessionId === sessionId) this.quota = this.#mockQuota
        return
      }
      if (!this.#ext) {
        // אין ext פעיל (session מנותק/mock ללא mockState.quota) — unavailable, לא קריסה.
        if (this.#sessionId === sessionId) this.quota = null
        return
      }
      const snapshot = await this.#ext.getQuota(sessionId)
      if (this.#sessionId === sessionId) this.quota = snapshot
    } catch {
      if (this.#sessionId === sessionId) this.quota = null
    } finally {
      if (this.#sessionId === sessionId) this.quotaLoading = false
    }
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
    if (key === "mode" && this.modes) {
      return typeof value === "string" && this.modes.availableModes.some((m) => m.id === value)
    }
    if (key === "model" && this.models) {
      return (
        typeof value === "string" && this.models.availableModels.some((m) => m.modelId === value)
      )
    }
    const opt = this.configOptions.find((o) => o.id === key || o.category === key)
    if (!opt) return false
    if (opt.type === "select" && typeof value === "string") {
      // flatten זהה ללוגיקה של flattenSelectOptions (SessionOptionsPanel) — inline ב-VM
      const flat = (
        opt.options as Array<{ value?: string; options?: Array<{ value: string }> }>
      ).flatMap((i) => ("options" in i && i.options ? i.options : [i as { value: string }]))
      return flat.some((c) => c.value === value)
    }
    if (opt.type === "boolean") return typeof value === "boolean"
    return true
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
    // ─── slice remote-session-mgmt C5: remote path — view.listSessions ───
    const remoteView = this.#remoteView()
    if (remoteView) {
      if (this.sessionsLoading) return
      if (this.#sessionsLoaded && !force) return
      this.sessionsLoading = true
      this.sessionsError = null
      try {
        // already normalized in the view (RemoteSessionView.listSessions)
        this.sessions = await remoteView.listSessions()
        this.#sessionsLoaded = true
      } catch (e) {
        // -32601 = the CLI doesn't support listing → empty list, not an error
        // (exactly like the local path; sessionsError stays null so the empty
        // list renders — the DoD's "gentle" handling, no crash).
        if ((e as { code?: number }).code === -32601) {
          this.sessions = []
          this.#sessionsLoaded = true
        } else {
          this.sessionsError = e instanceof Error ? e.message : String(e)
        }
      } finally {
        this.sessionsLoading = false
      }
      return
    }
    if (this.#client === null) return // אין חיבור — לא טוענים פה
    if (this.sessionsLoading) return
    if (this.#sessionsLoaded && !force) return
    this.sessionsLoading = true
    this.sessionsError = null
    try {
      const res = await this.#client.listSessions()
      const raw = (res as { sessions?: unknown[] }).sessions ?? []
      this.sessions = raw.map(normalizeSessionInfo)
      this.#sessionsLoaded = true
    } catch (e) {
      // -32601 = ה-CLI לא תומך (Gemini) → רשימה ריקה, לא שגיאה
      if ((e as { code?: number }).code === -32601) {
        this.sessions = []
        this.#sessionsLoaded = true
      } else {
        this.sessionsError = e instanceof Error ? e.message : String(e)
      }
    } finally {
      this.sessionsLoading = false
    }
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
    // ─── slice remote-session-mgmt C5: remote path — view.deleteSession ───
    const remoteView = this.#remoteView()
    if (remoteView) {
      try {
        await remoteView.deleteSession(sessionId)
      } catch (e) {
        if ((e as { code?: number }).code === -32601) return false // button hidden; defensive no-op
        this.sessionsError = e instanceof Error ? e.message : String(e)
        return false
      }
      // optimistic removal — same as local (the rpc already confirmed the delete)
      this.sessions = this.sessions.filter((s) => s.sessionId !== sessionId)
      const wasActive = sessionId === this.#sessionId
      if (wasActive) {
        this.#detachWith("delete") // navigates out — same wasActive logic as local
      }
      return wasActive
    }
    if (this.#client === null) return false
    try {
      await this.#client.deleteSession(sessionId)
    } catch (e) {
      if ((e as { code?: number }).code === -32601) return false // הכפתור מוסתר; defensive no-op
      this.sessionsError = e instanceof Error ? e.message : String(e)
      return false
    }
    // הסרה אופטימית — ה-ACP call כבר אישר את המחיקה, אין צורך בעוד round-trip (listSessions(true)).
    this.sessions = this.sessions.filter((s) => s.sessionId !== sessionId)
    const wasActive = sessionId === this.#sessionId
    if (wasActive) {
      this.#detachWith("delete") // מנקה גם sessions/sessionsLoaded/sessionsError — עקבי עם onDisconnect
    }
    return wasActive // הקומפוננטה מנווטת החוצה כשזה true
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

  // ─── slice session-title-in-process-list: דחיפת title ל-BE ───

  /**
   * דוחף את כותרת-הסשן הנוכחית ל-BE (PATCH /api/agents/:id) כדי שרשימת "תהליכים
   * פעילים" תציג אותה. best-effort — כשל דחיפה לא שובר UI (הכותרת המקומית כבר עודכנה
   * ב-this.sessionTitle לפני הקריאה). client הוא הבעלים — ה-BE שכבת-אחסון טיפשה.
   */
  #pushTitleToServer(title: string): void {
    const id = this.agentId
    if (!id || !title) return // אין agentId / כותרת ריקה → דלג
    void patchAgent(id, { title }).catch(() => {})
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
    if (next === "connected") this.#displaySnapshot = null
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
    this.configOptions = result.configOptions ?? []
    this.models = result.models ?? null
    this.modes = result.modes ?? null
    // slice-slash-commands: ניקוי בהחלפת/פתיחת סשן; ה-update הטרי יאכלס
    this.availableCommands = []
    // slice session-budget-meter: איפוס context-usage/quota בהחלפת/פתיחת סשן (#captureSessionConfig
    // אינו מאפס capabilities — ר' brief §0 — אבל contextUsage/quota הם שדות תוספתיים חדשים
    // ללא reset קודם, ולכן מתווספים כאן וב-#cleanup במפורש).
    this.contextUsage = null
    this.quota = null
    this.quotaLoading = false
    this.#mockQuota = undefined
    // slice subagent-tool-nesting: נקה מיפוי-קינון (החלפת/פתיחת סשן = מיפוי חדש)
    this.#subagentToolCallParents = new Map()
    // slice plan-todo-list: איפוס הצ'קליסט בהחלפת/פתיחת סשן (סשן חדש = אין תוכנית ישנה)
    this.planStore = EMPTY_PLAN_STORE
  }

  #cleanup(opts?: { keepAgent?: boolean; keepContext?: boolean }): void {
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
    this.#resolvePendingPermission({ outcome: { outcome: "cancelled" } })
    // slice-elicitation-ui: אותו דפוס — פתור גם elicitation ה-pending לפני close.
    this.#resolvePendingElicitation({ action: "cancel" })
    if (opts?.keepAgent && this.#transport) {
      this.#transport.sendRaw(`${JSON.stringify({ jsonrpc: "2.0", method: "$/detach" })}
`)
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
    this.contextUsage = null // slice session-budget-meter: נקה context-usage (חיבור חדש = caps חדשים)
    this.quota = null // slice session-budget-meter Commit 4: נקה quota
    this.quotaLoading = false
    this.#mockQuota = undefined
    this.#quotaFetchInFlight = null
    this.#claudeRawSdkMessageCount = 0
    // slice subagent-transcript-data-v2: נקה state תעתיק תת-סוכן (חיבור חדש = index/pending חדשים)
    this.#subagentIndex = createSubagentIndex()
    this.#pendingByParent = []
    // slice subagent-tool-nesting: נקה מיפוי-קינון (חיבור חדש = מיפוי חדש)
    this.#subagentToolCallParents = new Map()
    this.#transport = null // slice ws-reconnect-fix-nbug2: נקה ref
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
    // ל-reattach (#coldReconnect:749 מטפל במחיקת ה-agent הישן בנפרד, אחרי הצלחה).
    if (!opts?.keepAgent && !opts?.keepContext && agentId) void deleteAgent(agentId).catch(() => {})
  }

  /**
   * DEV-only: טוען fixture של updates גולמיים ומזרים אותם דרך #onSessionUpdate —
   * בדיוק כמו loadSession אמיתי (אותו ממיר, אותו status flow). מקור: static/fixtures/<name>.json.
   * delayMs > 0 → השהיה בין updates (לדמות streaming חי לדיבוג scroll/animations).
   */
  #loadMockSession = async (name: string, cwd: string): Promise<void> => {
    try {
      const res = await fetch(`/fixtures/${name}.json`)
      if (!res.ok) throw new Error(`fixture "${name}" not found (${res.status})`)
      const data = (await res.json()) as {
        updates: unknown[]
        loadResult?: {
          configOptions?: SessionConfigOption[] | null
          models?: SessionModelState | null
          modes?: SessionModeState | null
        }
        // ─── slice session-budget-meter Commit 5: mockState גנרי ─── (additive)
        mockState?: {
          capabilities?: Partial<NormalizedCapabilities>
          quota?: QuotaSnapshot | null
        }
      }
      this.cwd = cwd
      this.#sessionId = `mock:${name}`
      this.sessionTitle = `🧪 ${name}` // slice session-title: כותרת-דמו לharness הוויזואלי
      // DEV: לכוד configOptions/modes/models מ-loadResult של ה-fixture (אם קיים) —
      // מאפשר mockup של בוררי ה-config (mode/model/agent/effort) + descriptions ללא ACP חי.
      if (data.loadResult) this.#captureSessionConfig(data.loadResult)

      // ─── slice session-budget-meter Commit 5: mockState.capabilities/quota ───
      // #mockQuota מתאפס תמיד תחילה — מונע דליפה מ-mock session קודם (brief §0/§4 Commit 4).
      // fixture ללא mockState.quota → #mockQuota נשאר undefined → refreshQuota() נופל
      // ל-נתיב "אין #ext" (unavailable), לא מציג snapshot ישן.
      this.#mockQuota = undefined
      if (data.mockState) {
        if (data.mockState.capabilities) {
          // ממזג עם defaults בטוחים (כל השאר false) — לא מניח שהמפתח קיים ב-fixture.
          this.#capabilities = {
            mcp: false,
            compact: false,
            commands: false,
            usage: false,
            configOptions: false,
            rename: false,
            thinkingTokens: false,
            image: false,
            systemPrompt: "unsupported",
            ...data.mockState.capabilities,
          }
        }
        if ("quota" in data.mockState) {
          this.#mockQuota = data.mockState.quota
        }
      }

      // delay אופציונלי דרך ?stream=<ms> (ללא תשתית — sleep צד-לקוח בלבד)
      const params = new URLSearchParams(typeof location !== "undefined" ? location.search : "")
      const delayMs = Number(params.get("stream") ?? "0") || 0

      this.#resetTurnTracking() // NBug3: תור קודם השאיר #turnEnded=true + timer יתום
      this.isLoadingHistory = true
      try {
        for (const update of data.updates) {
          // עוטף בצורת SessionNotification ({ update }) כמו ב-ACP אמיתי
          this.#onSessionUpdate({ update } as unknown as SessionNotification)
          if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
        }
        // tick(): מאלץ flush של ה-$effect של ה-Speaker בעוד isLoadingHistory=true,
        // כך שכל הבועות מסומנות כמעובדות (replay-quiet) לפני ההצבה ל-false.
        // בלי זה הלולאה הסינכרונית מסתיימת לפני שה-effect רץ → ה-Speaker מקריא הכל.
        await tick()
      } finally {
        this.isLoadingHistory = false
        this.#setTurnState("idle") // NBug3: replay מסתיים — reset turnState
      }
      this.status = "connected"
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.error = `mock loadSession failed: ${msg}`
      this.#setTurnState("idle") // NBug3: throw מוקדם — ה-finally הפנימי אולי לא רץ
      this.status = "error"
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
      const ev = parseClaudeSdkMessage(params)
      if (ev.kind === "ignored") return
      const parentId = this.#subagentIndex.resolve(ev)
      if (parentId === undefined) return // task_updated לפני task_started — לא צפוי (§7), drop
      const idx = this.bubbles.findIndex(
        (b) => b.kind === "tool" && b.toolCall.toolCallId === parentId,
      )
      if (idx === -1) {
        this.#pushPendingSubagentEvent(parentId, ev)
        return
      }
      const task = this.bubbles[idx]
      // finding #3: this.bubbles[idx] הוא Bubble|undefined תחת noUncheckedIndexedAccess.
      if (!task || task.kind !== "tool") return
      this.bubbles[idx] = reduceSubagent(task, ev)
      return
    }
    // finding #2: ענף _drive/capabilities (וכל ענף עתידי) — ללא שינוי.
    if (method === "_drive/capabilities") {
      this.#capabilities = params as unknown as NormalizedCapabilities
    }
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
    const idx = this.bubbles.findIndex(
      (b) => b.kind === "tool" && b.toolCall.toolCallId === toolCallId,
    )
    if (idx === -1) return
    let task = this.bubbles[idx]
    if (!task || task.kind !== "tool") return
    for (const { event } of matching) {
      task = reduceSubagent(task, event)
    }
    this.bubbles[idx] = task
  }

  #onSessionUpdate = (notification: SessionNotification): void => {
    this.#onUpdateObserved?.(notification.update)
    this.#noteAgentActivity() // watchdog §2 — מסלול WS (כל session/update)

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
        this.#handleSubagentToolCall(update, parentToolUseId)
      } else {
        this.#applyToolCall(update)
      }
      return
    }
    if (update.sessionUpdate === "tool_call_update") {
      // slice subagent-tool-nesting §3 (אביגיל #3/#6): ה-Map (מבוסס tool_call create) הוא
      // מקור-הקישור האמין — לא ה-_meta של ה-update עצמו (חלק מה-updates לא נושאים parent).
      if (update.toolCallId !== undefined && this.#subagentToolCallParents.has(update.toolCallId)) {
        this.#handleSubagentToolCallUpdate(update)
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
          this.#handleSubagentToolCall(update, parentToolUseId)
        } else {
          // סדר חובה: turnState פר-pending/in_progress לפני ה-no-op guard (idx===-1) של reduce (אביגיל #4)
          if (update.status === "pending" || update.status === "in_progress") {
            this.#setTurnState("calling-tool")
            if (this.#turnEnded) this.#scheduleIdle()
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
    // cost אופציונלי: אם ה-update החדש משמיט אותו, שומר את הקודם (anti-flicker, brief §4).
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
      // SessionInfoUpdate: title?: string | null; updatedAt?: string | null (types.gen.d.ts:3905)
      const title = (update as { title?: string | null }).title
      if (title === null) {
        this.sessionTitle = "" // null = clear (לפי הסכמה)
      } else if (typeof title === "string") {
        this.sessionTitle = title
        if (!this.#isRemote) {
          this.#pushTitleToServer(this.sessionTitle) // slice session-title-in-process-list
        }
      }
      // undefined → keep-on-undefined (עקבי עם loadSession :999 / :1114)
      return
    }

    // §11: dispatch לפי contentType לפני ה-gate — כך user_message_chunk עם image/audio/resource_link
    // לא נזרק בשקט. ה-gate למטה חל רק על agent_message_chunk ו-agent_thought_chunk (text-only).
    const messageId = update.messageId ?? null

    if (update.sessionUpdate === "user_message_chunk") {
      // נשלח על ידי הסוכן במהלך ניגון מחדש של ההיסטוריה מ-loadSession (לפי מפרט ACP
      // סעיף §session-setup#loading-sessions). לעולם לא מגיע בתורים חיים —
      // אלה מקורם מ-sendPrompt ואנחנו מוסיפים להם את הבועה האופטימית שם.
      if (messageId !== null) {
        for (let i = this.bubbles.length - 1; i >= 0; i--) {
          const b = this.bubbles[i]
          if (
            b !== undefined &&
            b.kind === "user" &&
            (b.messageId === messageId || b.messageId === null)
          ) {
            if (b.messageId === null) b.messageId = messageId
            break
          }
        }
      }
      const content = update.content as
        | {
            type?: string
            text?: string
            data?: string
            mimeType?: string
            name?: string
            uri?: string
          }
        | undefined
      if (content?.type === "text") {
        // סימון user_message_chunk טקסטואלי דרך reduce (replay מהיסטוריה)
        const { state: nextState, patches } = reduce(this.sessionState, notification.update)
        this.sessionState = nextState
        applyPatchMutable(this.bubbles, patches, { mapToolContent, mapLocations })
      } else if (
        content?.type === "image" &&
        content.data !== undefined &&
        content.mimeType !== undefined
      ) {
        this.#appendUserImage(messageId, { mimeType: content.mimeType, data: content.data })
      } else if (content?.type === "resource_link") {
        // resource_link: מצרף placeholder כדי למנוע איבוד-שקט.
        // slice fs-file-proxy: תצוגה מלאה (markdown/תמונה/קישור) דרך ContentViewer.
        // §11.3א: i18n שייך לשכבת-הרכיב — ה-VM מצרף סמן מבני בלבד.
        const label = content.name ?? content.uri
        this.#appendUserPlaceholder(messageId, { kind: "resource_link", label, uri: content.uri })
      } else {
        // audio / resource (EmbeddedResource) / unknown — placeholder (אין יותר איבוד-שקט)
        // §11.3א: הרכיב מתרגם דרך t("chat.content.unsupported") — ה-VM לא כותב מפתח.
        const kind = content?.type === "audio" ? "audio" : "resource"
        this.#appendUserPlaceholder(messageId, { kind })
      }
      return
    }

    if (update.sessionUpdate === "agent_message_chunk") {
      const content = update.content as
        | {
            type?: string
            text?: string
            name?: string
            uri?: string
          }
        | undefined
      if (content?.type === "text") {
        const text = content.text ?? ""
        if (!text) return
        this.#setTurnState("responding")
        if (this.#turnEnded) this.#scheduleIdle()
        const { state: nextState1, patches: patches1 } = reduce(
          this.sessionState,
          notification.update,
        )
        this.sessionState = nextState1
        applyPatchMutable(this.bubbles, patches1, { mapToolContent, mapLocations })
      } else if (content !== undefined) {
        this.#setTurnState("responding")
        if (this.#turnEnded) this.#scheduleIdle()
        if (content.type === "resource_link") {
          const label = content.name ?? content.uri ?? ""
          this.#appendAgentPlaceholder(messageId, {
            kind: "resource_link",
            label,
            uri: content.uri,
          })
        } else if (content.type === "image") {
          this.#appendAgentPlaceholder(messageId, { kind: "image" })
        } else {
          const kind = content.type === "audio" ? "audio" : "resource"
          this.#appendAgentPlaceholder(messageId, { kind })
        }
      }
      return
    }

    if (update.sessionUpdate === "agent_thought_chunk") {
      const text =
        update.content?.type === "text" ? ((update.content as { text?: string }).text ?? "") : ""
      if (!text) return

      this.#setTurnState("thinking")
      if (this.#turnEnded) this.#scheduleIdle()
      const { state: nextState2, patches: patches2 } = reduce(
        this.sessionState,
        notification.update,
      )
      this.sessionState = nextState2
      applyPatchMutable(this.bubbles, patches2, { mapToolContent, mapLocations })
      return
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
      this.#flushPendingSubagentEvents(update.toolCallId)
    }
    // turnState תמיד calling-tool ללא תנאי (create, לא update)
    this.#setTurnState("calling-tool")
    if (this.#turnEnded) this.#scheduleIdle()
  }

  // ─── slice subagent-tool-nesting: כלים מקוננים של תת-סוכן ─────────────────────────

  /**

  // ─── slice subagent-tool-nesting: כלים מקוננים של תת-סוכן ─────────────────────────

  /**
   * tool_call של כלי-בן של תת-סוכן (`_meta.claudeCode.parentToolUseId`) — בונה `ToolBubble` עשיר
   * (אותה צורה שיוצר `#handleToolCall`) ומקנן אותו ב-`subFrames` של בועת ה-Task האב, במקום
   * top-level (brief §3). **fallback**: אם בועת-Task האב לא נמצאה — top-level רגיל (אל תשמיט).
   */
  #handleSubagentToolCall(
    update: {
      toolCallId?: string
      title?: string
      kind?: string
      rawInput?: unknown
      rawOutput?: unknown
      status?: ToolCall["status"]
      content?: unknown[] | null
      locations?: unknown[] | null
    },
    parentToolUseId: string,
  ): void {
    if (update.toolCallId === undefined) return
    const parentIdx = this.bubbles.findIndex(
      (b) => b.kind === "tool" && b.toolCall.toolCallId === parentToolUseId,
    )
    const parent = parentIdx === -1 ? undefined : this.bubbles[parentIdx]
    if (parent === undefined || parent.kind !== "tool") {
      // fallback (אביגיל r4 #1) — בועת-Task אב לא נמצאה: עדיף כלי top-level על כלי נעלם.
      this.#applyToolCall(update as Record<string, unknown>)
      return
    }

    const childBubble: ToolBubble = {
      id: safeUUID(),
      kind: "tool",
      messageId: null,
      createdAt: Date.now(),
      toolCall: {
        toolCallId: update.toolCallId,
        name: update.kind ?? update.title ?? "tool",
        kind: update.kind,
        args: update.rawInput ?? {},
        status: update.status ?? "pending",
        title: update.title,
        narration: undefined,
        result: update.rawOutput,
        content: update.content != null ? mapToolContent(update.content) : undefined,
        locations: update.locations != null ? mapLocations(update.locations) : undefined,
      },
      segments: [],
    }

    // immutable append + object-replacement (שומר reactivity, כמו B1).
    this.bubbles[parentIdx] = {
      ...parent,
      subFrames: [...(parent.subFrames ?? []), childBubble],
    }
    this.#subagentToolCallParents.set(update.toolCallId, parentToolUseId)
    this.#setTurnState("calling-tool")
    if (this.#turnEnded) this.#scheduleIdle()
  }

  /**
   * tool_call_update לכלי-בן מקונן (toolCallId ב-`#subagentToolCallParents`) — מאתר את ה-ToolBubble
   * ב-subFrames של בועת ה-Task האב **לפי `toolCall.toolCallId`** (לא `sf.id`/UUID — אביגיל #6)
   * ומעדכן אותו בתוך ה-subFrames (לא top-level).
   */
  #handleSubagentToolCallUpdate(update: {
    toolCallId?: string
    status?: ToolCall["status"]
    rawInput?: unknown
    rawOutput?: unknown
    kind?: string
    title?: string
    content?: unknown[] | null
    locations?: unknown[] | null
  }): void {
    if (update.toolCallId === undefined) return
    if (update.status === "pending" || update.status === "in_progress") {
      this.#setTurnState("calling-tool")
      if (this.#turnEnded) this.#scheduleIdle()
    }
    const parentToolUseId = this.#subagentToolCallParents.get(update.toolCallId)
    if (parentToolUseId === undefined) return
    const parentIdx = this.bubbles.findIndex(
      (b) => b.kind === "tool" && b.toolCall.toolCallId === parentToolUseId,
    )
    const parent = parentIdx === -1 ? undefined : this.bubbles[parentIdx]
    if (parent === undefined || parent.kind !== "tool") return

    const subFrames = parent.subFrames ?? []
    const childIdx = subFrames.findIndex(
      (sf) => sf.kind === "tool" && sf.toolCall.toolCallId === update.toolCallId,
    )
    if (childIdx === -1) return
    const oldChild = subFrames[childIdx]
    if (oldChild === undefined || oldChild.kind !== "tool") return

    const newToolCall: ToolCall = {
      ...oldChild.toolCall,
      ...(update.status !== undefined && { status: update.status }),
      ...(update.rawInput !== undefined && { args: update.rawInput }),
      ...(update.rawOutput !== undefined && { result: update.rawOutput }),
      ...(update.kind !== undefined && { kind: update.kind }),
      ...(update.title !== undefined && { title: update.title }),
      ...(update.content !== undefined && {
        content: update.content === null ? undefined : mapToolContent(update.content),
      }),
      ...(update.locations !== undefined && {
        locations: update.locations === null ? undefined : mapLocations(update.locations),
      }),
    }
    const newChild: ToolBubble = { ...oldChild, toolCall: newToolCall }
    const newSubFrames = [...subFrames]
    newSubFrames[childIdx] = newChild
    this.bubbles[parentIdx] = { ...parent, subFrames: newSubFrames }
  }

  /**
   * §11: מצרף image-attachment לבועת-user — קיבוץ לפי messageId כמו #appendChunk.
   *
   * הערה על reactivity: #appendChunk משתמש ב-segments.push() — עובד כי segments[]
   * הוא deep $state proxy ב-Svelte 5. attachments מתחיל undefined (optional ב-UserBubble),
   * לכן .push() על undefined יקרוס. לכן כאן **השמה** (`[..., a]`) — פותרת גם את
   * ה-undefined-init וגם מבטיחה reactivity על מערך שנוסף מאפס.
   */
  #appendUserImage(messageId: string | null, img: { mimeType: string; data: string }): void {
    const last = this.bubbles[this.bubbles.length - 1]
    const canGroup =
      last !== undefined &&
      last.kind === "user" &&
      (messageId !== null ? last.messageId === messageId : last.messageId === null)

    const attachment = { mimeType: img.mimeType, dataBase64: img.data }

    if (canGroup && last !== undefined) {
      const userBubble = last as UserBubble
      // השמה (לא push) כי attachments מתחיל undefined — ר' הערה מעל
      userBubble.attachments = [...(userBubble.attachments ?? []), attachment]
    } else {
      const newBubble: UserBubble = {
        id: safeUUID(),
        kind: "user",
        messageId,
        createdAt: Date.now(),
        segments: [],
        attachments: [attachment],
      }
      this.bubbles.push(newBubble)
    }
  }

  /**
   * §11.3א: מצרף placeholder מבני לבועת-user עבור ContentBlocks לא-טקסטואליים (resource_link / audio / resource).
   *
   * אותה לוגיקת קיבוץ כמו #appendUserImage — grouping לפי messageId.
   * contentPlaceholders מתחיל undefined → **השמה** (לא push), כמו attachments.
   * ה-VM לא מייבא t ולא כותב שום מחרוזת-תצוגה או מפתח i18n — i18n שייך לשכבת-הרכיב.
   */
  #appendUserPlaceholder(
    messageId: string | null,
    ph: { kind: "resource_link" | "audio" | "resource"; label?: string; uri?: string },
  ): void {
    const last = this.bubbles[this.bubbles.length - 1]
    const canGroup =
      last !== undefined &&
      last.kind === "user" &&
      (messageId !== null ? last.messageId === messageId : last.messageId === null)

    if (canGroup && last !== undefined) {
      const userBubble = last as UserBubble
      // השמה (לא push) כי contentPlaceholders מתחיל undefined — ר' הערה ב-#appendUserImage
      userBubble.contentPlaceholders = [...(userBubble.contentPlaceholders ?? []), ph]
    } else {
      const newBubble: UserBubble = {
        id: safeUUID(),
        kind: "user",
        messageId,
        createdAt: Date.now(),
        segments: [],
        contentPlaceholders: [ph],
      }
      this.bubbles.push(newBubble)
    }
  }

  /**
   * tool-render-fidelity: placeholder for non-text agent_message_chunk (§11.3א pattern).
   * i18n belongs to MessageBubble — VM stores structural marker only.
   */
  #appendAgentPlaceholder(
    messageId: string | null,
    ph: {
      kind: "resource_link" | "audio" | "resource" | "image"
      label?: string
      uri?: string
    },
  ): void {
    const last = this.bubbles[this.bubbles.length - 1]
    const canGroup =
      last !== undefined &&
      last.kind === "message" &&
      (messageId !== null ? last.messageId === messageId : last.messageId === null)

    if (canGroup && last !== undefined) {
      const msgBubble = last as MessageBubble
      msgBubble.contentPlaceholders = [...(msgBubble.contentPlaceholders ?? []), ph]
    } else {
      const newBubble: MessageBubble = {
        id: safeUUID(),
        kind: "message",
        messageId,
        createdAt: Date.now(),
        segments: [],
        contentPlaceholders: [ph],
      }
      this.bubbles.push(newBubble)
    }
  }
}
