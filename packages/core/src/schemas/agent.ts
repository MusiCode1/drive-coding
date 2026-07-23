import { type } from "arktype"

// ─── מקור-האמת היחיד ל-CLIs (שמות + פקודות) ─────────────────────────────────
// כאן יושב הכל במקום אחד: רשימת ה-CLIs, וגם פקודת ההרצה (bin/args) של כל אחד.
// הוספת CLI חדש = רשומה אחת ב-CLI_SPECS, וזהו — השם, הסכמה (arktype), ה-FE
// dropdown, ופקודת ההרצה כולם נגזרים מכאן.
//
// הערה ארכיטקטונית: bin/args הם נתונים סטטיים (מחרוזות), לא IO — ה-IO עצמו
// (spawn) חי ב-backend. resolution תלוי-סביבה (OPENCODE_BIN, הוספת --model)
// קורה ב-backend (getCliCommand), כי הוא נשען על process.env בזמן-ריצה.
// (D6 + D24)

export type CliSpec = {
  /** פקודת ההרצה (נתיב או שם ב-PATH). */
  readonly bin: string
  /** ארגומנטים קבועים שמועברים תמיד. */
  readonly args: readonly string[]
  /**
   * האם ה-CLI מקבל דריסת מודל דרך `--model <id>` בשורת הפקודה.
   * opencode = false: `opencode acp` לא מקבל `--model` — דריסת מודל פר-סשן
   * קורית בזמן session/new דרך ה-ACP SDK (לא דרך argv).
   */
  readonly supportsModelFlag: boolean
  /** משתני-סביבה להסרה מה-child לפני spawn (למשל proxy/CA של OneCLI). */
  readonly unsetEnv?: readonly string[]
  /** משתני-סביבה להוספה/דריסה ב-child לפני spawn. */
  readonly setEnv?: Readonly<Record<string, string>>
  /**
   * שם משתנה-סביבה שדורס את ה-bin (למשל OPENCODE_BIN — D14, Proxmox).
   * נצרך ע"י detectAvailableClis (slice cli-availability) כדי שגילוי הזמינות
   * יכבד את אותו סדר-עדיפויות כמו getCliCommand.
   */
  readonly envVar?: string
  /**
   * הבינארי לבדיקת-זמינות (detectAvailableClis, slice cli-availability) כשהוא שונה
   * מ-`bin` (ה-spawn-bin). claude/codex רצים in-process אבל ה-spawn-bin שלהם `npx`
   * (legacy) — detectBin מפריד את בדיקת-הזמינות מבדיקת-ה-npx. ספק ללא detectBin
   * משתמש ב-bin (spawned CLIs, ללא שינוי).
   */
  readonly detectBin?: string
}

export const CLI_SPECS = {
  opencode: { bin: "opencode", args: ["acp"], supportsModelFlag: false, envVar: "OPENCODE_BIN" },
  claude: {
    bin: "npx",
    args: ["-y", "@agentclientprotocol/claude-agent-acp@latest"],
    supportsModelFlag: true,
    detectBin: "claude",
  },
  gemini: { bin: "gemini", args: ["--acp"], supportsModelFlag: true },
  codex: {
    bin: "npx",
    args: ["-y", "@zed-industries/codex-acp@latest"],
    supportsModelFlag: true,
    detectBin: "codex",
  },
  qoder: { bin: "qodercli", args: ["--acp"], supportsModelFlag: true },
  cursor: { bin: "agent", args: ["acp"], supportsModelFlag: false },
  grok: {
    bin: "grok",
    args: ["--no-auto-update", "agent", "stdio"],
    supportsModelFlag: false, // חובה false — ר' טבלת argv ב-docs/plans/slice-cursor-acp.md §-1
  },
} as const satisfies Record<string, CliSpec>

// רשימת השמות נגזרת ממפתחות ה-specs — אין כפילות.
export const CLI_KINDS = Object.keys(CLI_SPECS) as readonly (keyof typeof CLI_SPECS)[]

// arktype enum נבנה מרשימת המקור — נשאר מסונכרן אוטומטית.
export const CliKind = type.enumerated(...CLI_KINDS)
export type CliKind = keyof typeof CLI_SPECS

// מכונת מצבים (State machine) של סטטוס
// starting: בתהליך spawn (Slice 3+)
// ready: זמין לקבל prompts
// busy: prompt בעבודה
// crashed: bridge נפל
// closed: כובה ע"י המשתמש
export const AgentStatus = type("'starting' | 'ready' | 'busy' | 'crashed' | 'closed'")
export type AgentStatus = typeof AgentStatus.infer

// פנימי — מיועד ל-backend בלבד
export const Agent = type({
  id: "string.uuid",
  cliKind: CliKind,
  cwd: "string",
  modelOverride: "string | null",
  status: AgentStatus,
  createdAt: "string.date.iso",
  // פרטי Bridge (יתמלאו ב-Slice 3)
  "bridgePort?": "number",
  "acpSessionId?": "string",
  // סיבת שגיאת ספק (Slice 5.6 — D47)
  "crashReason?": "string",
  // נעיצה (slice active-agents): נשמר לתאימות; ה-reaper הוסר — כרגע ללא אפקט (no-op). ברירת מחדל false.
  "persistent?": "boolean",
  // כותרת-הסשן (slice session-title-in-process-list): נדחפת ע"י ה-client שפתח את הסשן
  // (מקור: session_info_update ACP). runtime-only — נאבד ב-restart. null = ניקוי מכוון.
  "title?": "string | null",
})
export type Agent = typeof Agent.infer

// פומבי — מה שה-frontend מקבל
export const AgentPublic = type({
  id: "string.uuid",
  cliKind: CliKind,
  cwd: "string",
  modelOverride: "string | null",
  status: AgentStatus,
  createdAt: "string.date.iso",
  // מאוכלס כאשר status='crashed' ושגיאת הספק חולצה (Slice 5.6)
  "crashReason?": "string",
  // Slice 10: נוכח ברגע שה-FE השלים את לחיצת היד של ה-ACP וקרא ל-/session-attached.
  // ה-FE משתמש בזה בעת רענון כדי לקרוא ל-loadSession() במקום newSession() — מונע
  // התנגשות 409 ומשחזר את היסטוריית ה-session.
  "acpSessionId?": "string",
  // נעיצה — ה-FE מציג/משנה. אופציונלי: literals בטסטים לא חייבים לכלול אותו.
  "persistent?": "boolean",
  // runtime enrichment (מאוכלס ב-GET /api/agents handler, לא ב-toAgentPublic):
  "pid?": "number",
  "attached?": "boolean",
  // slice agent-busy-indicator: true כשיש turn פעיל (debounce-שקט)
  "busy?": "boolean",
  // slice agent-last-message-at: epoch-ms של הפלט האחרון שהסוכן שלח (כל sessionUpdate).
  // שים לב: epoch-ms (number), בשונה מ-createdAt שהוא ISO string. runtime-only — נאבד ב-restart.
  "lastMessageAt?": "number | null",
  // כותרת-הסשן (slice session-title-in-process-list): נדחפת ע"י ה-client שפתח את הסשן. runtime-only.
  "title?": "string | null",
})
export type AgentPublic = typeof AgentPublic.infer

// קלט ל-POST /api/agents
export const CreateAgentInput = type({
  cliKind: CliKind,
  cwd: "string >= 1",
  "modelOverride?": "string | null",
  // Slice 8a: טעינת session ACP קיים דרך session/load במקום newSession
  "existingSessionId?": "string",
  // slice project-system-prompt: פרומפט-מערכת פר-פרויקט, מתווסף (append) להוראות ברירת-המחדל.
  // גנרי — הצורה הספציפית-לספק נכתבת רק בקובץ-הספק (provider/connection).
  "systemPrompt?": "string | null",
})
export type CreateAgentInput = typeof CreateAgentInput.infer

// רשימה
export const AgentList = type({
  agents: AgentPublic.array(),
})
export type AgentList = typeof AgentList.infer

// פונקציית עזר — המרה מ-Agent ל-AgentPublic
export function toAgentPublic(agent: Agent): AgentPublic {
  const pub: AgentPublic = {
    id: agent.id,
    cliKind: agent.cliKind,
    cwd: agent.cwd,
    modelOverride: agent.modelOverride,
    status: agent.status,
    createdAt: agent.createdAt,
  }
  if (agent.crashReason !== undefined) {
    pub.crashReason = agent.crashReason
  }
  if (agent.acpSessionId !== undefined) {
    pub.acpSessionId = agent.acpSessionId
  }
  if (agent.persistent !== undefined) {
    pub.persistent = agent.persistent
  }
  if (agent.title !== undefined) {
    pub.title = agent.title
  }
  return pub
}
