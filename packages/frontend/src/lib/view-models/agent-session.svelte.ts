/**
 * AgentSession — view-model מינימלי עבור סשן ACP יחיד.
 *
 * מנהל (Owns):
 *   - מצב חיבור (status, error)
 *   - הצטברות בועות (bubble accumulation) מהתראות session/update
 *   - מתודות ציבוריות: attach/detach/sendPrompt
 *
 * משתמש ב-AcpClient האגנוסטי לתעבורה מתוך @drive-coding/core/acp,
 * עטוף עם ה-WsAcpTransport מצד ה-FE.
 */

import type {
  SessionNotification,
  SessionConfigOption,
  SessionModeState,
  SessionModelState,
} from "@agentclientprotocol/sdk"
import { createAcpClient, type AcpClient } from "@drive-coding/core/acp/client"
import type { CuesEngine } from "$lib/engines/cues"
import { WsAcpTransport } from "$lib/engines/ws-transport"
import { createAgent, notifySessionAttached } from "$lib/adapters/agents-api"
import type { CliKind } from "@drive-coding/core"
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

export type AgentSessionStatus =
  | "idle"        // טרם נוצר סוכן
  | "connecting"  // יוצר סוכן + לחיצת יד של ACP
  | "connected"   // מוכן לקבל פרומפטים
  | "thinking"    // נשלח פרומפט, ממתין לתגובת הסוכן
  | "error"

/**
 * ─── עיצוב תוספתי בטוח למקביליות (docs/conventions/parallel-safe-code.md) ───
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

  constructor(opts?: { cues?: CuesEngine }) {
    this.#cues = opts?.cues
  }

  // ─── state ─── (פולשני לעריכה — תאם מול Tama)
  status = $state<AgentSessionStatus>("idle")
  error = $state<string | null>(null)
  bubbles = $state<Bubble[]>([])
  agentId = $state<string | null>(null)
  cwd = $state<string | null>(null)
  // ─── slice 4: replay guard + narration context ─── (תוספתי)
  /** True בזמן ש-loadSession() מנגן היסטוריה מחדש. ה-Speaker קורא את זה (תחת מעקב) כדי להשתיק TTS. */
  isLoadingHistory = $state(false)
  /** טקסט הפרומפט האחרון שנשלח על ידי המשתמש — משמש את ה-Speaker להקשר עבור קריינות. */
  lastUserMessage = $state("")

  // ─── slice 23: session config ─── (תוספתי)
  /** אפשרויות config של הסשן הפתוח — מאוכלס מתגובת newSession/loadSession. */
  configOptions = $state<SessionConfigOption[]>([])
  /** מצב המודלים הזמינים — null אם ה-agent לא חשף מידע מודל. */
  models = $state<SessionModelState | null>(null)
  /** מצב ה-modes הזמינים — null אם ה-agent לא חשף מידע mode. */
  modes = $state<SessionModeState | null>(null)

  #client: AcpClient | null = null
  #sessionId: string | null = null
  /** חיפוש בסיבוכיות O(1) עבור tool_call_update לפי toolCallId. מ-Slice 4. */
  #toolBubbleByCallId: Map<string, ToolBubble> = new Map()
  /**
   * הערך הוא True בין detach() ל-attach() הבא. משתיק
   * שגיאות `WS closed (1005)` מזויפות מאירועי onClose שמופעלים לאחר שהמשתמש
   * התנתק באופן מפורש.
   */
  #detached = false

  // ─── מחזור חיי חיבור (connection lifecycle) ─────────────────────────

  /**
   * יצירת סוכן חדש עבור (cwd, cliKind), פתיחת WS, לחיצת יד של ACP, ורישום
   * של מאזין להתראות. לאחר ההשלמה, הסשן מוכן עבור sendPrompt.
   */
  attach = async (input: { cwd: string; cliKind: CliKind }): Promise<void> => {
    if (this.status === "connecting" || this.status === "connected") {
      throw new Error(`cannot attach in status ${this.status}`)
    }
    this.#setStatus("connecting")
    this.error = null
    this.bubbles = []
    this.#detached = false

    try {
      // 1. צור סוכן בצד השרת (BE)
      const { agentId } = await createAgent({ cwd: input.cwd, cliKind: input.cliKind })
      this.agentId = agentId
      this.cwd = input.cwd

      // 2. פתח תעבורת WS
      const proto = location.protocol === "https:" ? "wss:" : "ws:"
      const transport = new WsAcpTransport(`${proto}//${location.host}/ws/agent/${agentId}`)
      transport.onClose((code, reason) => {
        // השתק שגיאות כאשר הסגירה נגרמה על ידי קריאה מפורשת ל-detach().
        // הדפדפן סוגר את ה-WS בצורה אסינכרונית, לכן onClose מופעל אחרי ש-detach
        // כבר ניקה את המצב (state).
        if (this.#detached) return
        if (code !== 1000 && code !== 1001) {
          this.error = `WS closed (${code}): ${reason || "no reason"}`
          this.#setStatus("error")
        }
      })
      await transport.waitForOpen()

      // 3. לחיצת יד של ACP + סשן חדש
      this.#client = await createAcpClient(transport, this.#onSessionUpdate)
      const sessionResult = await this.#client.newSession({ cwd: input.cwd })
      this.#sessionId = (sessionResult as { sessionId?: string }).sessionId ?? null
      if (!this.#sessionId) {
        throw new Error("newSession returned no sessionId")
      }
      this.#captureSessionConfig(sessionResult)   // slice 23: לכוד config מה-session

      // 4. תגיד ל-BE לאיזה sessionId התחברנו (מאמץ מיטבי - best-effort)
      await notifySessionAttached(agentId, this.#sessionId).catch(() => {})

      this.#setStatus("connected")
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.error = msg
      this.#setStatus("error")
      this.#cleanup()
    }
  }

  detach = (): void => {
    this.#detached = true  // ‏לפני ה-cleanup — ‏ה-WS close fires async
    this.#cleanup()
    this.#setStatus("idle")
    this.error = null
    this.bubbles = []
  }

  // ─── פרומפטים (prompting) ────────────────────────────────────

  /**
   * שולח פרומפט של טקסט. `opts.recordingId` שמור עבור slice 10 (ניגון מחדש).
   * מחזיר Promise שמסתיים כשהתור מושלם (או נדחה בשגיאה).
   */
  sendPrompt = async (text: string, opts?: { recordingId?: string }): Promise<void> => {
    if (this.status !== "connected" && this.status !== "thinking") return
    if (!this.#client || !this.#sessionId) return
    if (!text.trim()) return

    // Slice 4: לכידה לטובת הקשר הקריינות
    this.lastUserMessage = text

    // אופטימי (optimistic): הוסף בועת משתמש מיד (מקטע יחיד, ללא messageId)
    const userBubble: UserBubble = {
      id: crypto.randomUUID(),
      kind: "user",
      messageId: null,
      createdAt: Date.now(),
      segments: [{ id: crypto.randomUUID(), text }],
      ...(opts?.recordingId !== undefined ? { recordingId: opts.recordingId } : {}),
    }
    this.bubbles.push(userBubble)
    this.#setStatus("thinking")

    try {
      await this.#client.prompt(this.#sessionId, text)
      if (this.status === "thinking") this.#setStatus("connected")
    } catch (err: unknown) {
      this.error = `prompt failed: ${err instanceof Error ? err.message : String(err)}`
      this.#setStatus("error")
    }
  }

  // ─── התמדת סשן (session persistence) ─── (מ-slice 8)

  /**
   * טוען סשן ACP קיים לפי sessionId.
   * דומה ל-attach() אך קורא ל-loadSession במקום ל-newSession.
   * לאחר ההשלמה, המצב הוא "connected" והסשן מוכן עבור sendPrompt.
   */
  loadSession = async (input: {
    sessionId: string
    cwd: string
    cliKind: CliKind
  }): Promise<void> => {
    if (this.status === "connecting" || this.status === "connected") {
      throw new Error(`cannot loadSession in status ${this.status}`)
    }
    this.#setStatus("connecting")
    this.error = null
    this.bubbles = []
    this.#detached = false

    try {
      // 1. צור סוכן בצד השרת (זהה ל-attach)
      const { agentId } = await createAgent({ cwd: input.cwd, cliKind: input.cliKind })
      this.agentId = agentId
      this.cwd = input.cwd

      // 2. פתח תעבורת WS + הוסף מאזין onClose (זהה ל-attach)
      const proto = location.protocol === "https:" ? "wss:" : "ws:"
      const transport = new WsAcpTransport(`${proto}//${location.host}/ws/agent/${agentId}`)
      transport.onClose((code, reason) => {
        if (this.#detached) return
        if (code !== 1000 && code !== 1001) {
          this.error = `WS closed (${code}): ${reason || "no reason"}`
          this.#setStatus("error")
        }
      })
      await transport.waitForOpen()

      // 3. לחיצת יד של ACP (זהה ל-attach)
      this.#client = await createAcpClient(transport, this.#onSessionUpdate)

      // ── קריאה ל-loadSession במקום ל-newSession ──
      // השתק את ה-TTS של ה-Speaker במהלך ניגון מחדש של ההיסטוריה (slice 4: replay-quiet).
      this.isLoadingHistory = true
      try {
        const loadResult = await this.#client.loadSession({ sessionId: input.sessionId, cwd: input.cwd })
        this.#captureSessionConfig(loadResult)   // slice 23: לכוד config (sessionId מ-input, לא מ-response)
      } finally {
        this.isLoadingHistory = false
      }
      this.#sessionId = input.sessionId

      // 4. הודע ל-BE (זהה ל-attach, מאמץ מיטבי)
      await notifySessionAttached(agentId, this.#sessionId).catch(() => {})

      this.#setStatus("connected")
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.error = `loadSession failed: ${msg}`
      this.#setStatus("error")
      this.#cleanup()
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
   */
  applyConfigOption = async (configId: string, value: string | boolean): Promise<void> => {
    if (this.status !== "connected" && this.status !== "thinking") return
    if (!this.#client || !this.#sessionId) return

    // מסלול 1: option קיים ב-configOptions לפי id
    const optById = this.configOptions.find((o) => o.id === configId)
    if (optById) {
      const res = await this.#client.setSessionConfigOption({
        sessionId: this.#sessionId, configId, value,
      })
      this.configOptions = res.configOptions
      return
    }

    // מסלול 2: fallback key "model"/"mode" — חפש לפי category
    if (configId === "model" && typeof value === "string") {
      const byCat = this.configOptions.find((o) => o.category === "model")
      if (byCat) {
        const res = await this.#client.setSessionConfigOption({
          sessionId: this.#sessionId, configId: byCat.id, value,
        })
        this.configOptions = res.configOptions
        return
      }
      // fallback — setSessionModel ישיר; עדכן models ידנית למניעת UI desync
      await this.#client.setSessionModel({ sessionId: this.#sessionId, modelId: value })
      if (this.models) this.models = { ...this.models, currentModelId: value }
      return
    }
    if (configId === "mode" && typeof value === "string") {
      const byCat = this.configOptions.find((o) => o.category === "mode")
      if (byCat) {
        const res = await this.#client.setSessionConfigOption({
          sessionId: this.#sessionId, configId: byCat.id, value,
        })
        this.configOptions = res.configOptions
        return
      }
      // fallback — setSessionMode ישיר; עדכן modes ידנית
      await this.#client.setSessionMode({ sessionId: this.#sessionId, modeId: value })
      if (this.modes) this.modes = { ...this.modes, currentModeId: value }
      return
    }

    // מסלול 3: לא נמצא — skip בשקט
    console.warn(`[AgentSession] configId "${configId}" not available — skipping`)
  }

  // ─── הקלטות (recordings) ─── (יתווסף ב-slice 10)

  // ─── slice 6: setter מרכז ─── (additive — מנתב את כל ה-status writes)

  /**
   * נקודת-mutation יחידה ל-status. כל שינוי status עובר דרך כאן.
   * מנגן audio cue ב-transitions רלוונטיים (slice 6). אין $effect — קריאה מפורשת.
   * idempotent: אם next === prev — לא מנגן cue (אין transition).
   */
  #setStatus(next: AgentSessionStatus): void {
    const prev = this.status
    if (next === prev) return
    this.status = next
    if (next === "thinking") this.#cues?.play("thinking")
    else if (next === "error") this.#cues?.play("error")
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
  }

  #cleanup(): void {
    try {
      this.#client?.close()
    } catch {
      // כבר סגור
    }
    this.#client = null
    this.#sessionId = null
    this.agentId = null
  }

  #mapToolContent(raw: unknown): ToolContent[] {
    if (!Array.isArray(raw)) return []
    const out: ToolContent[] = []
    for (const item of raw) {
      if (typeof item !== "object" || item === null) continue
      const t = (item as { type?: string }).type
      if (t === "content") {
        // { type:"content", content: ContentBlock }
        const cb = (item as { content?: { type?: string; text?: string } }).content
        if (cb?.type === "text" && typeof cb.text === "string") {
          out.push({ type: "text", text: cb.text })
        } else {
          out.push({ type: "other", raw: item }) // image/audio/resource — future
        }
      } else if (t === "diff") {
        const d = item as { path?: string; oldText?: string | null; newText?: string }
        if (typeof d.path === "string" && typeof d.newText === "string") {
          out.push({
            type: "diff",
            path: d.path,
            oldText: d.oldText ?? undefined,
            newText: d.newText,
          })
        } else {
          out.push({ type: "other", raw: item })
        }
      } else if (t === "terminal") {
        const term = item as { terminalId?: string }
        if (typeof term.terminalId === "string") {
          out.push({ type: "terminal", terminalId: term.terminalId })
        } else {
          out.push({ type: "other", raw: item })
        }
      } else {
        out.push({ type: "other", raw: item })
      }
    }
    return out
  }

  #mapLocations(raw: unknown): ToolLocation[] {
    if (!Array.isArray(raw)) return []
    const out: ToolLocation[] = []
    for (const item of raw) {
      if (typeof item !== "object" || item === null) continue
      const l = item as { path?: string; line?: number }
      if (typeof l.path === "string") {
        out.push({ path: l.path, line: l.line })
      }
    }
    return out
  }

  #onSessionUpdate = (notification: SessionNotification): void => {
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
      this.#handleToolCall(update)
      return
    }
    if (update.sessionUpdate === "tool_call_update") {
      this.#handleToolCallUpdate(update)
      return
    }

    const text = update.content?.type === "text" ? (update.content.text ?? "") : ""
    if (!text) return

    const messageId = update.messageId ?? null

    if (update.sessionUpdate === "agent_message_chunk") {
      this.#appendChunk("message", text, messageId)
    } else if (update.sessionUpdate === "agent_thought_chunk") {
      this.#appendChunk("thought", text, messageId)
    } else if (update.sessionUpdate === "user_message_chunk") {
      // נשלח על ידי הסוכן במהלך ניגון מחדש של ההיסטוריה מ-loadSession (לפי מפרט ACP
      // סעיף §session-setup#loading-sessions). לעולם לא מגיע בתורים חיים —
      // אלה מקורם מ-sendPrompt ואנחנו מוסיפים להם את הבועה האופטימית שם.
      this.#appendChunk("user", text, messageId)
    }
  }

  // ─── slice 4: מטפלים עבור קריאות לכלים (tool call handlers) ────────────────────────────

  #handleToolCall(update: {
    toolCallId?: string
    title?: string
    kind?: string
    rawInput?: unknown
    rawOutput?: unknown
    status?: ToolCall["status"]
    content?: unknown[] | null
    locations?: unknown[] | null
  }): void {
    if (update.toolCallId === undefined) return
    // סכמת ACP: התראה tool_call דורשת toolCallId + title. ה-title עלול להיות undefined
    // בפועל אם הסוכן שולח התראה מינימלית, לכן יש לסגת בצורה עדינה.
    const bubble: ToolBubble = {
      id: crypto.randomUUID(),
      kind: "tool",
      messageId: null,
      createdAt: Date.now(),
      toolCall: {
        toolCallId: update.toolCallId,
        // השם שווה ל-kind אם זמין, אחרת title. משמש פנימית + עבור הפרומפט של narrate.
        name: update.kind ?? update.title ?? "tool",
        kind: update.kind,
        args: update.rawInput ?? {},
        // הסטטוס הוא אופציונלי ב-tool_call ראשוני; כברירת מחדל "pending"
        status: update.status ?? "pending",
        title: update.title,
        narration: undefined,
        result: update.rawOutput,
        content: update.content != null ? this.#mapToolContent(update.content) : undefined,
        locations: update.locations != null ? this.#mapLocations(update.locations) : undefined,
      },
      segments: [],
    }
    this.bubbles.push(bubble)
    this.#toolBubbleByCallId.set(update.toolCallId, bubble)
  }

  #handleToolCallUpdate(update: {
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
    const idx = this.bubbles.findIndex(
      (b) => b.kind === "tool" && b.toolCall.toolCallId === update.toolCallId,
    )
    if (idx === -1) return
    const old = this.bubbles[idx] as ToolBubble
    // Svelte 5: החלף את האובייקט בשלמותו (ולא מוטציה במקום) כדי להפעיל ריאקטיביות.
    // שדה rawInput ממוזג כאן כי סוכני ACP (למשל opencode) לרוב שולחים
    // הודעת tool_call מינימלית תחילה (ללא rawInput או ריק) והפקודה האמיתית
    // מגיעה ב-tool_call_update — ראה ToolCallUpdate.rawInput במפרט ACP.
    const newToolCall: ToolCall = {
      ...old.toolCall,
      ...(update.status !== undefined && { status: update.status }),
      ...(update.rawInput !== undefined && { args: update.rawInput }),
      ...(update.rawOutput !== undefined && { result: update.rawOutput }),
      ...(update.kind !== undefined && { kind: update.kind }),
      ...(update.title !== undefined && { title: update.title }),
      ...(update.content !== undefined && {
        content: update.content === null ? undefined : this.#mapToolContent(update.content),
      }),
      ...(update.locations !== undefined && {
        locations: update.locations === null ? undefined : this.#mapLocations(update.locations),
      }),
    }
    this.bubbles[idx] = { ...old, toolCall: newToolCall }
    // שמור על ה-Map מסונכרן (מצביע לאובייקט ה-bubble החדש)
    this.#toolBubbleByCallId.set(update.toolCallId, this.bubbles[idx] as ToolBubble)
  }

  #appendChunk(
    kind: "message" | "thought" | "user",
    text: string,
    messageId: string | null,
  ): void {
    const last = this.bubbles[this.bubbles.length - 1]
    // קבץ יחד רק כאשר: (א) מאותו סוג, וגם (ב) מזהה הודעה (messageId) תואם ושאינו null.
    // מזהה הודעה null או חסר תמיד מתחיל בועה חדשה (לפי כלל הקיבוץ של ACP).
    const canGroup =
      last !== undefined &&
      last.kind === kind &&
      messageId !== null &&
      last.messageId === messageId

    if (canGroup && last !== undefined) {
      const seg: Segment = { id: crypto.randomUUID(), text }
      // last הוא מסוג MessageBubble | ThoughtBubble | UserBubble — לכולם יש מערכי segments
      if (last.kind === "message") {
        (last as MessageBubble).segments.push(seg)
      } else if (last.kind === "thought") {
        (last as ThoughtBubble).segments.push(seg)
      } else if (last.kind === "user") {
        (last as UserBubble).segments.push(seg)
      }
    } else {
      const newBubble: MessageBubble | ThoughtBubble | UserBubble =
        kind === "message"
          ? {
              id: crypto.randomUUID(),
              kind: "message",
              messageId,
              createdAt: Date.now(),
              segments: [{ id: crypto.randomUUID(), text }],
            }
          : kind === "thought"
          ? {
              id: crypto.randomUUID(),
              kind: "thought",
              messageId,
              createdAt: Date.now(),
              segments: [{ id: crypto.randomUUID(), text }],
            }
          : {
              id: crypto.randomUUID(),
              kind: "user",
              messageId,
              createdAt: Date.now(),
              segments: [{ id: crypto.randomUUID(), text }],
            }
      this.bubbles.push(newBubble)
    }
  }
}
