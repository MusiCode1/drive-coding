/**
 * types.ts — provider-agnostic host interfaces.
 *
 * No sdk@1.0.0 types leak here. Only NormalizedCapabilities + Record<string,unknown>.
 */

/**
 * Normalized capability surface, derived from agent initialize response.
 * Consumers read these flags; host internals discover them.
 */
export interface NormalizedCapabilities {
  /** mcpCapabilities present in initialize → true */
  mcp: boolean
  /** Not declared in initialize (runtime feature) → false */
  compact: boolean
  /** Not declared in initialize (runtime feature) → false */
  commands: boolean
  /**
   * true = this provider implements the `_drive/getQuota` quota-handler contract
   * (slice session-budget-meter). This is NOT a promise that a snapshot exists —
   * an account with no visible limits yet still returns { snapshot: null }, a
   * valid supported response. Consumers must not read this as "has limits".
   */
  usage: boolean
  /**
   * configOptions from session/new response if called; otherwise false.
   * NOT hardcoded true — must be discovered at runtime.
   */
  configOptions: boolean
  /**
   * renameSession() available in @anthropic-ai/claude-agent-sdk → true for claude.
   * Store-level operation (no patch required). Consumer calls host.rename(id, title).
   */
  rename: boolean
  /**
   * query.setMaxThinkingTokens() available via live query object (ClaudeAcpAgent.sessions).
   * Runtime control — no patch required. Controlled via ext channel (_drive/setThinkingTokens).
   */
  thinkingTokens: boolean
  /**
   * promptCapabilities.image from the real initialize response (tapped from the wire,
   * not hardcoded per-provider). false until the tap observes an init-response frame.
   * Slice reattach-state-sync Commit 1 — see extractPromptCaps (core).
   */
  image: boolean
  /**
   * Static declaration — NOT discovered at runtime via ACP.
   * How project charter (systemPrompt) is applied for this provider:
   * - `"native"` — provider injects via native channel (claude _meta / codex developer_instructions)
   * - `"prepended"` — charter prepended to the first user turn (spawn path, set at connect)
   * - `"unsupported"` — no charter support; FE may warn when a project prompt is configured
   */
  systemPrompt: "native" | "prepended" | "unsupported"
}

/**
 * Generic in-process host interface.
 * Implementations (e.g. claude) are provider-specific; this surface is not.
 */
export interface AdapterHost {
  start(opts: { cwd: string }): Promise<{ capabilities: NormalizedCapabilities }>
  callExt(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>
  onExtNotification(cb: (method: string, params: Record<string, unknown>) => void): () => void
  close(): Promise<void>
}
