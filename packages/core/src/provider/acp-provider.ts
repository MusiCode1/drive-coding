/**
 * acp-provider.ts — AcpProviderSession: עוטף AcpClient מאחורי ProviderSession הקנוני,
 * + mapAcpCapabilities (AgentCapabilities → ProviderCapabilities).
 *
 * P1b/§3 + §9. החלטות:
 *   - sendPrompt לא-חוסם: client.prompt() חוסם עד סוף ה-turn (agent-session:493), לכן
 *     מפעילים אותו ללא await, מחזירים PromptAck{turnId,running} מיד, ופולטים turn.end
 *     כש-prompt() resolves (§9 #2 — turnId הוא uuid שה-adapter מייצר).
 *   - capabilities ← client.capabilities (= SDK AgentCapabilities), לא ports.ts AcpCapabilities.
 */
import type { AgentCapabilities } from "@agentclientprotocol/sdk"
import type { AcpClient } from "../acp/client.js"
import { createAcpClient } from "../acp/client.js"
import type { AcpTransport } from "../acp/transport.js"
import type {
  ConsumerCapabilities,
  ProviderCapabilities,
  ProviderEvent,
  ProviderSession,
  PromptAck,
  PromptContent,
  PromptContentPart,
} from "./events.js"
import { mapAcpNotification } from "./map-acp-notification.js"

/**
 * AgentCapabilities (SDK) → ProviderCapabilities (קנוני).
 * resume/list נגזרים מ-ACP caps; permissions/tools = true (drive-coding flow תמיד).
 * שאר היכולות (diff/terminal/fs/mcp...) — שמרניות (false) עד שייצפו (§2 capability-gated).
 */
export function mapAcpCapabilities(caps: AgentCapabilities | undefined): ProviderCapabilities {
  const session = caps?.sessionCapabilities
  return {
    // session/load (loadSession) או session/resume מעידים על יכולת חידוש
    resume: caps?.loadSession === true || session?.resume != null,
    list: session?.list != null,
    // אין מושג ACP ל-delete סשן; close נגזר מ-session/close
    delete: false,
    close: session?.close != null,
    permissions: true,
    images: caps?.promptCapabilities?.image === true,
    tools: true,
    diff: false,
    revert: false,
    fs: false,
    terminal: false,
    mcpExternal: caps?.mcpCapabilities != null,
    mcpEmbedded: false,
  }
}

/**
 * StopReason ACP = end_turn | max_tokens | max_turn_requests | refusal | cancelled.
 * רק "refusal" מייצג סיום חריג/שגיאה; limits ו-cancelled הם סיומים תקינים.
 */
function isErrorStop(stopReason: string): boolean {
  return stopReason === "refusal"
}

export interface AcpProviderSessionOptions {
  transport: AcpTransport
  cwd: string
  /** דריסת timeout האתחול של createAcpClient (בבדיקות מעבירים ערך קטן). */
  initTimeoutMs?: number
}

export class AcpProviderSession implements ProviderSession {
  readonly providerId = "acp"
  sessionId = ""
  capabilities: ProviderCapabilities = mapAcpCapabilities(undefined)

  readonly #transport: AcpTransport
  readonly #cwd: string
  readonly #initTimeoutMs?: number
  #client: AcpClient | null = null
  #emit?: (e: ProviderEvent) => void

  constructor(opts: AcpProviderSessionOptions) {
    this.#transport = opts.transport
    this.#cwd = opts.cwd
    this.#initTimeoutMs = opts.initTimeoutMs
  }

  async start(_consumer: ConsumerCapabilities): Promise<void> {
    const client = await createAcpClient(
      this.#transport,
      (n) => {
        const ev = mapAcpNotification(n)
        if (ev) this.#emit?.(ev)
      },
      this.#initTimeoutMs !== undefined ? { initTimeoutMs: this.#initTimeoutMs } : {},
    )
    this.#client = client
    this.capabilities = mapAcpCapabilities(client.capabilities)
    const res = await client.newSession({ cwd: this.#cwd })
    this.sessionId = res.sessionId
    this.#emit?.({
      type: "session.ready",
      sessionId: this.sessionId,
      capabilities: this.capabilities,
    })
  }

  async sendPrompt(content: PromptContent): Promise<PromptAck> {
    if (!this.#client) throw new Error("AcpProviderSession.sendPrompt called before start()")
    const text = extractText(content)
    const turnId = crypto.randomUUID()
    // ⚠️ prompt() חוסם עד סוף ה-turn — אין await. PromptAck מיד; turn.end on resolve (§9 #2).
    this.#client
      .prompt(this.sessionId, text)
      .then((res) => {
        this.#emit?.({
          type: "turn.end",
          turnId,
          stopReason: res.stopReason,
          isError: isErrorStop(res.stopReason),
        })
      })
      .catch((err: unknown) => {
        this.#emit?.({
          type: "error",
          error: { message: err instanceof Error ? err.message : String(err) },
        })
      })
    return { turnId, status: "running" }
  }

  async cancel(_turnId?: string): Promise<void> {
    // ACP cancel הוא ברמת-סשן; ה-prompt() התלוי יסתיים עם stopReason "cancelled".
    await this.#client?.cancel(this.sessionId)
  }

  async stop(): Promise<void> {
    this.#client?.close()
  }

  onEvent(handler: (e: ProviderEvent) => void): () => void {
    this.#emit = handler
    return () => {
      if (this.#emit === handler) this.#emit = undefined
    }
  }

  // ─── tier 2 — capability-gated ───
  async listSessions(): Promise<unknown[]> {
    if (!this.#client) return []
    const res = await this.#client.listSessions()
    return res.sessions ?? []
  }

  async resumeSession(id: string): Promise<void> {
    await this.#client?.loadSession({ cwd: this.#cwd, sessionId: id })
  }
}

/** חילוץ text מ-PromptContent. client.prompt דורש (sessionId, text:string) — §3. */
function extractText(content: PromptContent): string {
  if (typeof content === "string") return content
  return content
    .filter((p): p is Extract<PromptContentPart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("")
}
