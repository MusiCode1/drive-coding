/**
 * acp-provider.ts — AcpProviderSession: עוטף AcpClient מאחורי ProviderSession הקנוני,
 * + mapAcpCapabilities (AgentCapabilities → ProviderCapabilities).
 *
 * P1b/§3. שלד Commit 0 — המימוש המלא נכנס ב-Commit 2 (session) ו-Commit 3 (capabilities).
 */
import type { AgentCapabilities } from "@agentclientprotocol/sdk"
import type { AcpTransport } from "../acp/transport.js"
import type {
  ConsumerCapabilities,
  ProviderCapabilities,
  ProviderEvent,
  ProviderSession,
  PromptAck,
  PromptContent,
} from "./events.js"

export function mapAcpCapabilities(_caps: AgentCapabilities | undefined): ProviderCapabilities {
  throw new Error("not implemented (Commit 3)")
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

  constructor(_opts: AcpProviderSessionOptions) {
    throw new Error("not implemented (Commit 2)")
  }

  async start(_consumer: ConsumerCapabilities): Promise<void> {
    throw new Error("not implemented (Commit 2)")
  }

  async sendPrompt(_content: PromptContent): Promise<PromptAck> {
    throw new Error("not implemented (Commit 2)")
  }

  async cancel(_turnId?: string): Promise<void> {
    throw new Error("not implemented (Commit 2)")
  }

  async stop(): Promise<void> {
    throw new Error("not implemented (Commit 2)")
  }

  onEvent(_handler: (e: ProviderEvent) => void): () => void {
    throw new Error("not implemented (Commit 2)")
  }
}
