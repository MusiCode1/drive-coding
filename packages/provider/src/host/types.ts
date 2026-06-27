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
  /** Not declared in initialize (runtime feature) → false */
  usage: boolean
  /**
   * configOptions from session/new response if called; otherwise false.
   * NOT hardcoded true — must be discovered at runtime.
   */
  configOptions: boolean
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
