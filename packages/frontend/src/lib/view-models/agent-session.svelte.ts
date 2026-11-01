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
import type { WsAcpTransport } from "@drive-coding/acp-wire/browser"
// ─── slice reconnect-ws-takeover: תרגום נקודתי להודעת "נפתח במקום אחר" ───
// ה-VM לרוב לא מייבא t() (i18n שייך לשכבת-הרכיב — ר' #appendUserPlaceholder), אבל
// `error` הוא string גולמי שמוצג as-is (routes/+page.svelte:191, לא עובר t() ברכיב) —
// כמו הודעות "WS closed (...)" הקיימות. חייב לעבור דרך core/i18n (לא Hebrew ליטרלי
// בקוד — lint:i18n אוכף), ולא להשתמש ב-I18nVM (לא מוזרק ל-VM הזה).
import { DEFAULT_CLAUDE_SESSION_META } from "@drive-coding/core"
import { createI18n, detectLocale } from "@drive-coding/core/i18n"
import type {
  AcpClient,
  createAcpClient,
  // ─── slice-image-paste Commit 4a/4b: טיפוס blocks לשליחה מולטימודלית ───
  PromptBlocks,
} from "@drive-coding/provider/client"
import {
  deleteAgent,
  notifySessionAttached,
  patchAgent,
  releaseConnection,
} from "$lib/adapters/agents-api"
// ─── slice sessions-inline: normalize ───
import { normalizeSessionInfo, type SessionInfo } from "$lib/adapters/sessions"
import type { CuesEngine } from "$lib/engines/cues"
// ─── slice leave-running-background ───
import type { AgentInput, CloseMode, Connection } from "$lib/session/connection"
import type { HttpConnection } from "$lib/session/http-connection"
// ─── slice local-view-wiring: LocalSessionView + tee ───
import { LocalSessionView } from "$lib/session/local-session-view"
import type { SessionView } from "$lib/session/session-view"
// ─── slice session-view-port C3: SessionView DI ───
import { projectSessionSnapshot } from "$lib/session/session-view-projection"
import { WsConnection } from "$lib/session/ws-connection"
import { runColdReconnect } from "$lib/session/ws-reconnect-controller"
import type { Bubble, UserBubble } from "$lib/types/bubble"
// ─── slice-elicitation-ui: טיפוסי שאלה מובנת (view-model layer, נגזרים מ-SDK) ───
import { connInfo } from "$lib/util/conn-log"
import { isBypassMode } from "$lib/util/permission-mode"
import { safeUUID } from "$lib/util/uuid"
import {
  type ApplyConfigOptionDeps,
  type ApplyConfigToClientDeps,
  applyConfigOption as applyConfigOptionExtracted,
  bindConfigDeps,
  restoreRememberedConfig,
} from "$lib/view-models/agent-session-apply-config"
import {
  type CaptureSessionConfigDeps,
  captureSessionConfig,
} from "$lib/view-models/agent-session-capture-config"
import {
  type DeleteSessionDeps,
  deleteSession as deleteSessionExtracted,
} from "$lib/view-models/agent-session-delete"
import type { TransportTestStub } from "$lib/view-models/agent-session-detach-frame"
import { type LoadMockSessionDeps, loadMockSession } from "$lib/view-models/agent-session-load-mock"
// ─── slice surface-real-error: עדיפות data.details→data.message→message→String(e) ───
import {
  applyManualTitleFromAttach,
  applyTitleFromSessionInput,
  type ManualTitleInput,
  setManualTitleOnAgent,
  syncTitleFromViewState,
} from "$lib/view-models/agent-session-manual-title"
import { createAgentSessionHttpBinding } from "$lib/view-models/agent-session-new-http-connection"
import {
  createSessionOperations,
  type NewSessionInput,
  type SessionOperationsDeps,
  type SessionWriteTarget,
  type SwitchSessionInput,
} from "$lib/view-models/agent-session-operations"
import {
  endSessionScope,
  registerSessionEndListener,
  type SessionEndReason,
  type SessionEndScopeDeps,
} from "$lib/view-models/agent-session-session-end"
import { ErrorScope } from "$lib/view-models/error-scope.svelte"
import { formatAcpError } from "$lib/view-models/format-acp-error"
import { LocalTurnWatchOwner } from "$lib/view-models/local-turn-watch-owner.svelte"
import {
  installPendingUiOnAgentSession,
  type PendingElicitation,
  type PendingPermission,
  type PendingUiScope,
} from "$lib/view-models/pending-ui-scope.svelte"
import { SessionBudgetOwner } from "$lib/view-models/session-budget-owner.svelte"
import {
  SessionConfigOwner,
  type SessionModelState,
} from "$lib/view-models/session-config-owner.svelte"
import { SessionScope } from "$lib/view-models/session-scoped-state.svelte"
import { SessionsCacheScope } from "$lib/view-models/sessions-cache-scope.svelte"
import type { Settings } from "$lib/view-models/settings.svelte"
import { createAgentSessionProjection } from "./agent-session-projection"

export type { SessionEndReason } from "$lib/view-models/agent-session-session-end"

// ─── image-attach kill-switch ─── (slice-image-paste Commit 2)
// Commit 4b הפך ל-true — שליחה מולטימודלית פעילה.
// supportsImageInput קורא raw #client.capabilities.promptCapabilities.image
// (§10 הכרעה א — raw, לא NormalizedCapabilities).
const IMAGE_INPUT_ENABLED = true

// ─── slice plan-todo-list Commit 1: reducer טהור + טיפוסים ─── (additive)
import type { PlanStore } from "@drive-coding/core/acp/plan"
// ─── slice session-state-reducer C4: reduce + types ─── (additive)
import { createInitialSessionState, type SessionState } from "@drive-coding/core/session"
// ─── slice FE-normalization: ייבוא ─── (additive)
// import type בלבד — NormalizedCapabilities מ-subpath ./types (pure, ללא spawn-core).
// ⚠️ אל תייבא value מ-@drive-coding/provider/host → יגרור spawn-core → vite crash.
import type { NormalizedCapabilities } from "@drive-coding/provider/types"
import { createExtClient, type ExtClient } from "$lib/adapters/ext"
// ─── slice session-state-reducer C4: FE patch applicator + mappers ─── (additive)
import { TranscriptScope } from "$lib/view-models/transcript-scope.svelte"
// ─── slice subagent-transcript-data-v2: פרסר+reducer טהורים (additive) ───
import { parseClaudeSdkMessage } from "./claude-subagent-parse"
import type { HistoryMark } from "./history-mark.js"
import { watchPageVisibility } from "./page-visibility.js"
import {
  createSpeakerTranscriptPort,
  type TranscriptProcessingTarget,
} from "./speaker-transcript-port"

/**
 * _meta שמוזרק ל-session/new+load של claude בלבד — מחזיר thinking summaries
 * ומבקש raw SDK frames ל-spike של subagent transcript.
 * Opus 4.7+ שינה default ל-display:"omitted"; זה מבקש "summarized" מפורשות.
 * provider-agnostic: ה-key claudeCode מתעלם ע"י ספקים אחרים.
 */
/** Local FE path only — config file does not affect this (brief session-meta-config §4.6). */
const CLAUDE_SESSION_META = DEFAULT_CLAUDE_SESSION_META

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
  #operations = createSessionOperations(this.#operationsDeps())
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

  readonly turnWatch!: Readonly<Pick<LocalTurnWatchOwner, "stalled">>
  #turnWatchOwner!: LocalTurnWatchOwner

  readonly budget!: SessionBudgetOwner
  #budgetOwner!: SessionBudgetOwner

  readonly config = new SessionConfigOwner()

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
    const errorScope = this.#errorScope
    const self = this
    this.#pendingUi = installPendingUiOnAgentSession(self, {
      get error() {
        return errorScope.message
      },
      set error(v: string | null) {
        errorScope.message = v
      },
      get bypassActive() {
        return self.bypassActive
      },
      view: () => self.#view,
      tearingDown: () => self.#tearingDown,
    })
    const browser = typeof document !== "undefined"
    this.#turnWatchOwner = new LocalTurnWatchOwner({
      onGiveUp: () => this.#setTurnState("idle"),
      enabled: browser,
    })
    this.turnWatch = this.#turnWatchOwner
    if (browser) this.#turnWatchOwner.start()
    this.#budgetOwner = new SessionBudgetOwner({
      sessionId: () => this.#sessionId,
      supportsUsage: () => this.supports.usage,
      isRemote: () => this.#remoteView() !== null,
      ext: () => this.#ext,
    })
    this.budget = this.#budgetOwner
    // ─── slice session-view-port C3: אם view הוזרק ─── (additive)
    if (opts?.view) {
      this.#view = opts.view
      this.#isRemote = true // slice local-view-wiring C1: DI של view == remote (כל 5 הקונסטרוקציות)
      this.#bindProjection(opts.view, true, true)
      const connection = this.#newHttpConnection()
      connection.adoptExistingView(opts.view)
      this.#connection = connection
    }
  }

  // ─── state ─── (פולשני לעריכה — תאם מול Tama)
  status = $state<AgentSessionStatus>("idle")
  /** מה המודל עושה בתור הנוכחי. idle = אין תור פעיל. */
  turnState = $state<TurnState>("idle")
  #errorScope = $state(new ErrorScope())

  get error(): string | null {
    return this.#errorScope.message
  }
  set error(value: string | null) {
    this.#errorScope.message = value
  }
  // ─── slice auth-guidance: authMethods שנלכדו מ-initialize (client.authMethods) ───
  /** [] = אין כשל-auth ידוע / warm-reattach (מדלג initialize) / CLI לא מפרסם authMethods. */
  authMethods = $state<ReadonlyArray<AuthMethod>>([])
  #transcript = new TranscriptScope()
  get bubbles(): Bubble[] {
    return this.#transcript.bubbles
  }
  set bubbles(next: Bubble[]) {
    this.#transcript.replace(next)
  }
  // ─── slice session-state-reducer C4: מצב SessionState פנימי (base ל-reduce) ─── (additive)
  sessionState = $state<SessionState>(createInitialSessionState({ sessionId: null }))
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
  #historyMarkProcessingTarget: TranscriptProcessingTarget | null = null
  get historyMark(): HistoryMark {
    return this.#historyMark
  }
  /** טקסט הפרומפט האחרון שנשלח על ידי המשתמש — משמש את ה-Speaker להקשר עבור קריינות. */
  lastUserMessage = $state("")

  #pendingUi!: PendingUiScope

  pendingPermission!: PendingPermission | null
  pendingElicitation!: PendingElicitation | null

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
  get userNotes(): string {
    return this.#session.userNotes
  }
  set userNotes(v: string) {
    this.#session.userNotes = v
  }
  get sessionFields(): Record<string, string> {
    return this.#session.sessionFields
  }
  set sessionFields(v: Record<string, string>) {
    this.#session.sessionFields = v
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

  // ─── slice reconnect-bubble-merge: render-consumers (additive) ───
  /** רשימת התצוגה. בזמן warm-reconnect replay מוקפאת ל-snapshot; אחרת = live bubbles. */
  get renderBubbles(): Bubble[] {
    return this.#transcript.renderBubbles
  }

  /** true רק בזמן warm-reconnect replay (התצוגה קפואה). לא נדלק בטעינה ראשונית/switchSession. */
  get isReconnectReplay(): boolean {
    return this.#transcript.isReconnectReplay
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
  /** Counter פנימי ל-spike raw SDK. לא נרנדר ב-UI. */
  #claudeRawSdkMessageCount = 0
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
      this.#session = new SessionScope(id)
      this.#budgetOwner.reset()
    }
    this.#sessionId = id
  }

  #sessionEndScopeDeps(): SessionEndScopeDeps {
    return { sessionEndListeners: () => this.#sessionEndListeners }
  }

  #operationsDeps(): SessionOperationsDeps {
    return {
      read: () => ({
        status: this.status,
        cwd: this.cwd,
        loading: this.isLoadingHistory,
        agentId: this.agentId,
        client: this.#client,
        view: this.#view,
        remoteView: this.#remoteView(),
        connection: this.#connection,
        detached: this.#detached,
        tearingDown: this.#tearingDown,
      }),
      scope: () => this.#session,
      sessionId: () => this.#sessionId,
      attach: (input) => this.attach(input),
      load: (input) => this.loadSession(input),
      end: (reason) => this.#endSessionScope(reason),
      status: (status) => this.#setStatus(status),
      resetError: () => this.#errorScope.reset(),
      error: (message) => {
        this.error = message
      },
      loading: (value) => {
        this.isLoadingHistory = value
      },
      idle: () => this.#setTurnState("idle"),
      resetTurn: () => this.#resetTurnTracking(),
      clearTranscript: () => this.#transcript.replace([]),
      beginProjection: (id) => this.#beginLocalProjection(id, true),
      title: (value) => {
        this.sessionTitle = value
      },
      cwd: (value) => {
        this.cwd = value
      },
      enter: (id) => this.#enterSession(id),
      adoptLocal: (client, id) => this.#adoptLocalView(client, id),
      captureConfig: (result) => this.#captureSessionConfig(result),
      applyTitle: (input) => this.#applyTitleFromSessionInput(input),
      meta: () => this.#sessionMeta(),
      notify: (agentId, id, cwd) => notifySessionAttached(agentId, id, { replace: true, cwd }),
      restore: (target: SessionWriteTarget) =>
        restoreRememberedConfig(this.#boundConfigDeps(target)),
      isMock: (id) => import.meta.env.MODE !== "production" && id.startsWith("mock:"),
    }
  }

  #applyConfigToClientDeps(): Omit<ApplyConfigToClientDeps, "isCurrent"> {
    return {
      ...this.config.applyClientTargets(),
      client: () => this.#client,
      sessionId: () => this.#sessionId,
    }
  }

  #applyConfigOptionDeps(): Omit<ApplyConfigOptionDeps, "isCurrent"> {
    return {
      ...this.#applyConfigToClientDeps(),
      status: () => this.status,
      remoteView: () => this.#remoteView(),
      cliKind: () => this.#cliKind,
      settings: () => this.#settings,
    }
  }

  #captureSessionConfigDeps(): CaptureSessionConfigDeps {
    return {
      captureConfig: (r) => this.config.capture(r),
      setAvailableCommands: (v) => {
        this.availableCommands = v
      },
      resetBudget: () => {
        this.#budgetOwner.reset()
      },
      session: () => this.#session,
      setPlanStore: (v) => {
        this.planStore = v
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
  // ─── slice view-switch C3-ו: guard-זהות ל-pending (remote) ─── (additive)
  /**
   * ה-id שזה עתה נענה, פר-סוג — סוגר patch-מעופש (BE שרת פותר pending, ולכן patch
   * שהגיע אחרי שכבר עניתי הוא "reply שהוקדם" — no-op). ❌ אין #openPermissionId: "מה
   * פתוח כרגע" נקרא מהמקור היחיד (pendingPermission?.requestId), לא ממצב-מראה שני.
   * ⚠️ requestId הוא פר-host ומתחיל מ-0 בכל agent חדש — מאופס ב-attachRemote וב-#cleanup.
   */
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

  #bindProjection(view: SessionView, remote: boolean, bootstrap = false): void {
    const vm = this
    const sink = createAgentSessionProjection({
      ui: {
        get modes() {
          return vm.config.modes
        },
        set modes(v) {
          vm.config.modes = v
        },
        get configOptions() {
          return vm.config.configOptions
        },
        set configOptions(v) {
          vm.config.configOptions = v
        },
        get availableCommands() {
          return vm.availableCommands
        },
        set availableCommands(v) {
          vm.availableCommands = v
        },
        get planStore() {
          return vm.planStore
        },
        set planStore(v) {
          vm.planStore = v
        },
        mergeUsage: (u) => {
          this.#budgetOwner.mergeUsage(u)
        },
        get titleManual() {
          return vm.titleManual
        },
        set titleManual(v) {
          vm.titleManual = v
        },
        get sessionTitle() {
          return vm.sessionTitle
        },
        set sessionTitle(v) {
          vm.sessionTitle = v
        },
      },
      transcript: this.#transcript,
      parents: () => this.#session.subagentToolCallParents,
      turnEnded: () => this.#turnEnded,
      setTurnState: (next) => this.#setTurnState(next),
      scheduleIdle: () => this.#scheduleIdle(),
      onExtNotification: this.#onExtNotification,
      pushTitle: (title) => this.#pushTitleToServer(title),
      setSessionState: (state) => {
        this.sessionState = state
      },
      setHistory: (mark) => {
        this.#historyMark = mark
        this.#historyMarkProcessingTarget = this.#transcript.captureProcessingTarget()
        this.historyEpoch++
      },
      beforeUpdate: (update) => {
        this.#onUpdateObserved?.(update)
        this.#noteAgentActivity()
      },
      endBatch: (state) => {
        if (remote) this.#syncFromViewState(state)
      },
      current: () => this.#view === view,
      onHostRecreated: () => {
        this.#operations.invalidate()
        this.isLoadingHistory = false
        this.#pendingUi.clearLocalUi()
      },
    })
    view.bindProjection(sink)
    if (bootstrap) {
      const state = view.state
      sink.applyFrame(projectSessionSnapshot(state, state.messages.length > 0), () => {})
      sink.endBatch(state)
    }
  }

  #beginLocalProjection(sessionId: string | null, preserveControl = false): void {
    const view = this.#localView ?? this.#bindLocalView()
    view.begin(sessionId, preserveControl)
    this.sessionState = view.state
  }

  // ─── slice local-view-wiring C3: קשירה ואימוץ מקומיים (brief §4.3-§4.5) ───

  /**
   * שלב א' — **לפני** יצירת הלקוח (ה-callbacks קופאים ביצירתו — §2.5): משחרר את
   * הקודם (`#localView.dispose()`, לא close — הלקוח משותף), ובונה view חדש עם
   * state קנוני בבעלות SessionViewDelivery. מציב אותו ב-#localView וב-#view מיד
   * (סוגר את חלון-היתום של attach/loadSession שנכשלים אחריו — §4.5), וקושר
   * כותב פריימים סינכרוני; ה-holder ב-VM מקבל רק את state הפריים שנצרך.
   */
  #bindLocalView(): LocalSessionView {
    this.#localView?.dispose()
    const view = new LocalSessionView({
      cwd: this.cwd ?? "",
      cliKind: this.#cliKind ?? "",
    })
    this.#operations.invalidate()
    this.isLoadingHistory = false
    this.#localView = view
    this.#view = view
    this.sessionState = view.state
    this.#bindProjection(view, false)
    return view
  }

  #callbacksForLocalView(view: LocalSessionView): Parameters<typeof createAcpClient>[1] {
    return {
      onUpdate: (notification) => view.ingestUpdate(notification.update),
      onExtNotification: this.#onExtNotification,
      ...this.#pendingUi.acpClientCallbacks(),
    }
  }

  /**
   * שלב ב' — **אחרי** יצירת הלקוח, **לפני** כל קריאה שמזרימה היסטוריה (§4.4):
   * מאמץ את הלקוח וזהות הסשן אל ה-view ושומר תוכן ופריימים מוקדמים שכבר הגיעו.
   * switchSession/newSession מקומיים משתמשים באותו לקוח ו-view בלי dispose או
   * בנייה מחדש; ה-callbacks שנוצרו עם הלקוח ממשיכים למסור עדכונים לאותו view.
   */
  #adoptLocalView(client: AcpClient, sessionId: string): void {
    this.#localView?.adopt({ client, sessionId })
    if (this.#localView) this.sessionState = this.#localView.state
  }

  /**
   * מסנכרן שדות metadata מ-state הפריים שנצרך לשדות ה-$state של ה-VM.
   * נקרא ב-endBatch של הכותב הסינכרוני במסלול HTTP.
   */
  #syncFromViewState(viewState: SessionState): void {
    // ─── slice view-switch C3-ו: view נלכד פעם אחת — משמש את ה-shim של pending למטה ───
    const view = this.#view
    if (!view) return
    this.#noteAgentActivity() // watchdog §2 — מסלול HTTP (batch patches)
    // turnState (נגזר מסוג patch ב-reduce) — ✅ ללא תנאי, ה-BE הוא הסמכות (isSpuriousIdle בוטל)
    const vt = viewState.turnState as TurnState
    if (vt !== this.turnState) this.#setTurnState(vt)
    syncTitleFromViewState(this, viewState.title)
    this.#budgetOwner.updateFromView({
      contextUsage: viewState.contextUsage as UsageUpdate | null,
      quota: viewState.quota,
    })
    // commands
    this.availableCommands = viewState.commands as typeof this.availableCommands
    this.config.syncFromHttpView({
      modes: viewState.modes as SessionModeState | null,
      configOptions: viewState.configOptions as SessionConfigOption[],
    })
    // ─── slice http-usable C1: capabilities from SessionState → #capabilities ───
    // In remote there is no #client, and _drive/capabilities is only sent by
    // ws-agent — so supportsImageInput was always false over HTTP. The BE now
    // fills state.capabilities and the snapshot carries it; this is where it
    // lands in the VM. null = not received yet → never clobber an existing value.
    if (viewState.capabilities !== null && viewState.capabilities !== this.#capabilities) {
      this.#capabilities = viewState.capabilities as NormalizedCapabilities
    }

    // ─── slice view-switch C3-ו.1: pending (permission + elicitation) — guard-זהות ───
    this.#pendingUi.syncFromView(viewState.pending, view)

    // ─── slice view-switch C3-ו.2: lastTurnError → session.error (דו-כיווני, ממוקד) ───
    this.#errorScope.syncTurnError(viewState.lastTurnError)
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

  /**
   * @internal slice http-live-side-effects — המסלול האמיתי של onSseReconnected.
   * שגיאה חולפת (switchSession/newSession) נמחקת ב-reconnect; טרמינלית (#errorSurfaced) שורדת.
   */
  _onSseReconnectedForTest(): void {
    if (!this.#errorScope.surfaced) this.error = null
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
    if (this.#connection) {
      this.#connection.release()
      return
    }
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
    this.#errorScope.surfaced = v
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
    if (!this.#isRemote && !(this.#connection instanceof WsConnection))
      this.#connection = this.#newWsConnection()
  }
  /**
   * @internal חושף #sessionId לטסטים (לבדיקת הזרקת state).
   */
  _getSessionIdForTest(): string | null {
    return this.#sessionId
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
    if (this.#connection instanceof WsConnection)
      await this.#connection.onUnexpectedClose(code, reason)
  }

  // ─── מחזור חיי חיבור (connection lifecycle) ─────────────────────────

  #newWsConnection(): WsConnection {
    const connection: WsConnection = new WsConnection({
      connectionId: this.#connectionId,
      isBound: () => this.#connection === connection,
      prepareNew: () => {
        this.#operations.invalidate()
        this.#setStatus("connecting")
        this.#errorScope.reset()
        this.authMethods = []
        this.#transcript.replace([])
        this.#detached = false
      },
      setAgent: (agentId, cwd, cliKind) => {
        if (this.#connection !== connection) return
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
        if (this.#connection !== connection) return
        this.#client = client
        this.authMethods = client.authMethods
        this.#ext = createExtClient(client)
      },
      sessionMeta: () => this.#sessionMeta(),
      enterSession: (sessionId) => this.#enterSession(sessionId),
      adoptLocalView: (client, sessionId) => this.#adoptLocalView(client, sessionId),
      captureSessionConfig: (result) => this.#captureSessionConfig(result),
      connected: async () => {
        if (this.#connection !== connection) return
        this.#setStatus("connected")
        await this.#applyRememberedConfig()
      },
      failed: (error) => {
        if (this.#connection !== connection) return
        this.#errorScope.surface(formatAcpError(error))
        this.#setStatus("error")
        this.#cleanup()
      },
      prepareExisting: (agent) => {
        this.#operations.invalidate()
        this.#errorScope.reset()
        this.#detached = false
        this.#enterSession(agent.sessionId)
        this.agentId = agent.agentId
        this.cwd = agent.cwd
        this.#cliKind = agent.cliKind
        applyManualTitleFromAttach(this, agent, true)
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
            detached: this.#detached || this.#connection !== connection,
            tearingDown: this.#tearingDown,
            remote: this.#isRemote,
            terminalError: this.#errorScope.surfaced && this.error !== null,
          }
        },
        snapshot: () => {
          this.#transcript.freezeDisplay()
        },
        setStatus: (status) => this.#setStatus(status),
        setAttempt: (attempt) => {
          this.reconnectAttempt = attempt
        },
        setTerminal: (kind) => {
          const t = createI18n({ locale: this.#settings?.locale ?? detectLocale() }).t
          this.error = t(
            kind === "takeover" ? "session.openedElsewhere" : "session.heldByOtherTransport",
          )
          this.#setStatus("disconnected")
        },
        setCrashError: (detail) => {
          this.error = detail
        },
        setWarmHostActiveError: () => {
          this.error = createI18n({ locale: this.#settings?.locale ?? detectLocale() }).t(
            "session.heldByOtherTransport",
          )
        },
        clearTransientError: () => {
          this.error = null
        },
        clearClient: () => {
          this.#client = null
          this.#ext = null
          this.#pendingUi.cancelDialogs()
        },
        prepareWarm: () => {
          this.#operations.invalidate()
          this.#detached = false
          this.#errorScope.surfaced = false
          this.#client = null
          this.#pendingUi.cancelDialogs()
        },
        setWarmAgent: (agentId) => {
          this.agentId = agentId
          connection.updateReleaseAgent(agentId)
        },
        setAttachedClient: (client) => {
          this.#client = client
          this.#ext = createExtClient(client)
        },
        startReplay: () => {
          this.#transcript.replace([])
          this.#beginLocalProjection(this.#sessionId)
          this.isLoadingHistory = true
        },
        finishReplay: () => {
          this.isLoadingHistory = false
          this.#setTurnState("idle")
        },
        disposeFailedWarm: () => {
          this.#client = null
          this.#ext = null
          this.#pendingUi.cancelDialogs()
          connection.disposeFailedWarmView()
          this.#localView = null
          this.#view = null
        },
        cold: (isCurrent) =>
          runColdReconnect(
            { sessionId: this.#sessionId, cwd: this.cwd, cliKind: this.#cliKind },
            isCurrent,
            {
              prepare: () => {
                connection.closeClientForCold()
                this.#client = null
                this.#ext = null
                this.#pendingUi.cancelDialogs()
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
          this.#errorScope.reset()
          connInfo("reconnected", { agentId: this.agentId })
        },
      },
    })
    return connection
  }

  #newHttpConnection(): HttpConnection {
    return createAgentSessionHttpBinding({
      state: this,
      connectionId: this.#connectionId,
      getBoundConnection: () => this.#connection,
      view: () => this.#view,
      operations: this.#operations,
      errors: this.#errorScope,
      transcript: this.#transcript,
      answered: this.#pendingUi.answered,
      prepareIdentity: (agent) => {
        this.#detached = false
        this.#cliKind = agent.cliKind
      },
      bindView: (view) => {
        this.#view = view
        this.#isRemote = true
        this.#bindProjection(view, true)
      },
      enterSession: this.#enterSession.bind(this),
      rememberedConfig: this.#applyRememberedConfig.bind(this),
      onSseReconnected: this._onSseReconnectedForTest.bind(this),
      cleanup: (keepAgent) => this.#cleanup(keepAgent ? { keepAgent: true } : undefined),
      status: this.#setStatus.bind(this),
      endScope: () => this.#endSessionScope("remote-terminal"),
      turnIdle: () => this.#setTurnState("idle"),
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
      this.#errorScope.surface(formatAcpError(e))
    })
  }

  async #leaveSession(reason: SessionEndReason, keepAgent: boolean): Promise<void> {
    this.#endSessionScope(reason)
    this.#detached = true
    this.#connection?.cancelReconnect()
    this.reconnectAttempt = 0
    if (keepAgent && (this.pendingPermission || this.pendingElicitation)) {
      await this.#pendingUi.detachForLeaveBeforeCleanup(this.#isRemote)
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
    const modeOpt = this.config.configOptions.find((o) => o.category === "mode")
    const liveModeId =
      modeOpt && modeOpt.type === "select"
        ? (modeOpt as Extract<SessionConfigOption, { type: "select" }>).currentValue
        : undefined
    return isBypassMode(this.#cliKind, liveModeId ?? this.config.modes?.currentModeId)
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

  resolvePermission!: (optionId: string) => void
  cancelPermission!: () => void
  resolveElicitation!: (content: Record<string, string | number | boolean | string[]>) => void
  cancelElicitation!: (action: "decline" | "cancel") => void

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
      this.#transcript.append(userBubble)
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
    this.#operations.invalidate()
    if (!opts?.preserveContextOnError) {
      this.#endSessionScope("load")
    }
    this.#setStatus("connecting")
    this.#errorScope.reset()
    this.authMethods = [] // slice auth-guidance: נקה לפני חיבור חדש — נלכד מחדש אחרי createAcpClient
    this.#transcript.replace([])
    this.#beginLocalProjection(input.sessionId)
    this.#detached = false

    // ─── DEV-only: mock session (sessionId "mock:<name>") ───
    // זורם updates גולמיים מ-fixture דרך אותו #onSessionUpdate כמו ACP חי —
    // ללא createAgent/WS/ACP. כלי דיבוג עיצוב; tree-shaken מ-prod build.
    if (import.meta.env.MODE !== "production" && input.sessionId.startsWith("mock:")) {
      await loadMockSession(
        this.#loadMockSessionDeps(),
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
    await owner.loadSession(
      input,
      {
        published: (agentId) => {
          if (!opts?.preserveContextOnError) this.agentId = agentId
          this.cwd = input.cwd
          this.#cliKind = input.cliKind
        },
        replaying: (loading) => {
          this.isLoadingHistory = loading
          if (!loading) this.#setTurnState("idle")
        },
        loaded: () => {
          this.#enterSession(input.sessionId)
          this.#applyTitleFromSessionInput(input)
        },
        connected: (agentId) => {
          this.agentId = agentId
          this.#setStatus("connected")
        },
        failed: (e) => {
          this.error = `loadSession failed: ${formatAcpError(e)}`
          this.#errorScope.surfaced = true // calev-heavy §10.2 + reconnect-recovery anti-clobber
          this.#setTurnState("idle") // NBug3: throw מוקדם (createAgent/waitForOpen) — ה-finally הפנימי לא רץ
          // slice reconnect-recovery: נתיב-השימור (cold-reconnect שנכשל) — לא #cleanup() מלא
          // (שהיה מוחק #sessionId/agentId ותוקע את reconnect() ב-early-return). שומר את
          // הקשר-הסשן כדי שלחיצת reconnect הבאה תמצא #sessionId ותנסה שוב (§3 diagram).
          if (opts?.preserveContextOnError) {
            // מאפס #tearingDown=false → surfaced guard ב-controller הוא מה שמונע clobber+
            // auto-reconnect על ה-async close (אביגיל r3 🔴).
            this.#cleanup({ keepContext: true }) // teardown מלא; אותו owner נשמר לניסיון הבא
            this.#setStatus("disconnected") // מציג כפתור reconnect; reconnect() לא-early-return (context נשמר)
          } else {
            this.#setStatus("error")
            this.#cleanup()
          }
        },
      },
      opts,
    )
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
  switchSession = (input: SwitchSessionInput): Promise<void> =>
    this.#operations.switchSession(input)
  newSession = (input: NewSessionInput): Promise<void> => this.#operations.newSession(input)

  // ─── slice 4: עזרי הקשר לקריינות ─── (תוספתי)

  /**
   * מחזיר את הטקסט של ה-n MessageBubbles האחרונות של הסייען כמחרוזות.
   * משמש את ה-Speaker כדי לבנות NarrateContext עבור קריינות קריאה לכלי.
   */
  recentAssistantMessages(n: number = 3): string[] {
    return this.#transcript.recentAssistantMessages(n)
  }

  speakerTranscript() {
    return createSpeakerTranscriptPort(this.#transcript, {
      status: () => this.status,
      turnState: () => this.turnState,
      isLoadingHistory: () => this.isLoadingHistory,
      historyEpoch: () => this.historyEpoch,
      historyMark: () => ({
        mark: this.historyMark,
        processingTarget: this.#historyMarkProcessingTarget,
      }),
      lastUserMessage: () => this.lastUserMessage,
    })
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
    await applyConfigOptionExtracted(this.#boundConfigDeps(), configId, value)
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

  // Bound config snapshots share the controller lifetime token.
  #boundConfigDeps(target = this.#operations.captureTarget()): ApplyConfigOptionDeps {
    return bindConfigDeps(this.#applyConfigOptionDeps(), () => target.isCurrent())
  }
  async #applyRememberedConfig(): Promise<void> {
    await restoreRememberedConfig(this.#boundConfigDeps())
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
    this.#pendingUi.cancelDialogs()
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
    setManualTitleOnAgent(this, title)
  }

  #applyTitleFromSessionInput(input: { title?: string; titleManual?: boolean }): void {
    applyTitleFromSessionInput(this, input, (t) => this.#pushTitleToServer(t))
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
    if (next === "connected") this.#transcript.releaseDisplay()
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
    if (prev === "idle") this.#turnWatchOwner.turnStarted()
    else if (next === "idle") this.#turnWatchOwner.turnEnded()
  }

  /** פעילות מהסוכן — WS (`beforeUpdate`) ו-HTTP (`#syncFromViewState`). */
  #noteAgentActivity(): void {
    this.#turnWatchOwner.noteActivity()
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
    this.#operations.invalidate()
    const owner = this.#connection
    if (!opts?.keepContext) {
      owner?.cancelReconnect()
      this.#connection = null
    }
    // לכוד את ה-agentId לפני האיפוס — צריך אותו ל-deleteAgent.
    const agentId = this.agentId
    // נקה timer של tail-debounce (msr-v2 — NBug1 opencode)
    if (this.#idleTimer !== null) {
      clearTimeout(this.#idleTimer)
      this.#idleTimer = null
    }
    this.#turnWatchOwner.stop()
    // ─── slice be-shutdown-hardening Commit 3: $/detach לפני סגירה מכוונת ───
    // keepAgent=true = leaveRunning — FE מודיע ל-BE שהוא עוזב מרצון.
    // ה-BE מקבל $/detach → markDetached מיד → reconnect-ghost נסגר מיידית
    // (במקום לחכות ל-sweep של ה-WS אחרי 60s).
    // WS: resolve pending callbacks before transport close. HTTP keepAgent: local UI clear only.
    this.#pendingUi.detachOnCleanup(!!opts?.keepAgent, this.#isRemote)
    if (opts?.keepAgent && this.#isRemote && owner) {
      owner.release()
    }
    const closeMode: CloseMode = opts?.keepAgent
      ? { kind: "preserve-agent" }
      : opts?.keepContext
        ? { kind: "recover" }
        : { kind: "end-view" }
    if (owner) {
      owner.close(closeMode)
    } else if (this.#view) {
      void this.#view.close().catch(() => {})
    }
    this.#localView?.dispose()
    this.#client = null
    this.#view = null
    this.#localView = null // slice local-view-wiring C3: איפוס כפול לצד #view (§4.3)
    this.#isRemote = false // slice local-view-wiring C1: איפוס מתג-המצב לצד איפוס ה-view
    // ─── slice view-switch C3-ו: מרחב-ה-ids של pending הוא פר-host, לא פר-VM ───
    // בלי איפוס — הדיאלוג הראשון של הסשן המרוחק הבא באותו טאב מדוכא בשקט (id 0 "כבר נענה").
    this.#pendingUi.resetAnsweredIds()
    this.#ext = null // slice FE-normalization: נקה facade
    this.#capabilities = null // slice FE-normalization: נקה capabilities (חיבור חדש = caps חדשים)
    this.#budgetOwner.reset()
    this.#claudeRawSdkMessageCount = 0
    // slice subagent-transcript-data-v2: נקה state תעתיק תת-סוכן (חיבור חדש = index/pending חדשים)
    this.#transcript.resetSubagentProjection()
    // slice subagent-tool-nesting: נקה מיפוי-קינון (חיבור חדש = מיפוי חדש)
    this.#session.subagentToolCallParents = new Map()
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
    if (!opts?.keepAgent && !opts?.keepContext && agentId) {
      if (owner) owner.deleteAgentOnce(agentId)
      else void deleteAgent(agentId).catch(() => {})
    }
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
        this.#budgetOwner.setMockQuota(v)
      },
      setCapabilities: (v) => {
        this.#capabilities = v
      },
      resetTurnTracking: () => this.#resetTurnTracking(),
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
      const ev = parseClaudeSdkMessage(params)
      if (ev.kind === "ignored") return
      this.#transcript.onSubagentEvent(ev)
      return
    }
    // finding #2: ענף _drive/capabilities (וכל ענף עתידי) — ללא שינוי.
    if (method === "_drive/capabilities") {
      this.#capabilities = params as unknown as NormalizedCapabilities
    }
  }

  #onSessionUpdate = (notification: SessionNotification): void => {
    if (!this.#localView) throw new Error("Local projection has not begun")
    this.#localView.ingestUpdate(notification.update)
  }
}
