import type { NormalizedCapabilities } from "@drive-coding/provider/types"
import type { ClaudeSubagentEvent } from "./claude-subagent-parse"
import { parseClaudeSdkMessage } from "./claude-subagent-parse"

const ALL_FALSE_SUPPORTS: NormalizedCapabilities = {
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

export type SessionCapabilitiesTranscriptDep = {
  onSubagentEvent: (ev: ClaudeSubagentEvent) => void
}

/** Connection-scoped capabilities snapshot (slice state-agent-session-capabilities-owner). */
export class SessionCapabilitiesOwner {
  #capabilities: NormalizedCapabilities | null = null
  #claudeRawSdkMessageCount = 0

  readonly #transcript: () => SessionCapabilitiesTranscriptDep

  constructor(transcript: () => SessionCapabilitiesTranscriptDep) {
    this.#transcript = transcript
  }

  get capabilities(): NormalizedCapabilities | null {
    return this.#capabilities
  }

  get claudeRawSdkMessageCount(): number {
    return this.#claudeRawSdkMessageCount
  }

  get showsSystemPromptWarning(): boolean {
    const caps = this.#capabilities
    return caps !== null && caps.systemPrompt === "unsupported"
  }

  get supports(): NormalizedCapabilities {
    return this.#capabilities ?? ALL_FALSE_SUPPORTS
  }

  setCapabilities(value: NormalizedCapabilities | null): void {
    this.#capabilities = value
  }

  /** HTTP batch — null does not clobber an existing value. */
  syncFromHttpView(viewCapabilities: NormalizedCapabilities | null | undefined): void {
    if (viewCapabilities !== null && viewCapabilities !== this.#capabilities) {
      this.#capabilities = viewCapabilities
    }
  }

  reset(): void {
    this.#capabilities = null
    this.#claudeRawSdkMessageCount = 0
  }

  onExtNotification = (method: string, params: Record<string, unknown>): void => {
    if (method === "_claude/sdkMessage") {
      this.#claudeRawSdkMessageCount += 1
      const ev = parseClaudeSdkMessage(params)
      if (ev.kind === "ignored") return
      this.#transcript().onSubagentEvent(ev)
      return
    }
    if (method === "_drive/capabilities") {
      this.#capabilities = params as unknown as NormalizedCapabilities
    }
  }
}
