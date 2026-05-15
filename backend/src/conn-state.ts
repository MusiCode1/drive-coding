/**
 * Per-connection state — held by `server.ts` in a WeakMap keyed by the
 * WebSocket. Extracted to its own file so that handlers can reference
 * the shape without depending on `server.ts` (which spawns Bun.serve on
 * import, making it untestable).
 */

import type { AcpBridge } from "./acp-bridge.ts";

export interface ConnState {
  bridge: AcpBridge | null;
  busy: boolean;
  /** Whether the system prompt was already injected into this session. */
  firstPromptSent: boolean;
  /** TTS voice ID selected for this session (ElevenLabs). */
  voiceId: string | null;
  /**
   * The last flushed model-message segment — used as STT context on the
   * next user audio. The *last* segment is what the user heard, not the
   * accumulated whole response.
   */
  lastAgentMessage: string | null;
  /**
   * The last user text (transcript or direct text). Used as context for
   * `narrateToolCall`.
   */
  lastUserText: string | null;
  /**
   * Up to 3 last flushed agent message segments, in chronological order.
   * Used as context for `narrateToolCall`.
   */
  recentMessages: string[];
  /** The cwd received in `init`. Stored for recordings metadata. */
  cwd: string | null;
  /** Active sessionId (after handleInit). Stored for recordings metadata. */
  sessionId: string | null;
}

/** Creates a fresh `ConnState` with defaults — used on WebSocket open. */
export function createConnState(): ConnState {
  return {
    bridge: null,
    busy: false,
    firstPromptSent: false,
    voiceId: null,
    lastAgentMessage: null,
    lastUserText: null,
    recentMessages: [],
    cwd: null,
    sessionId: null,
  };
}
