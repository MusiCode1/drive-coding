/**
 * Pure logic for parsing + routing client WebSocket messages.
 *
 * Separated from `server.ts` so it can be tested without spinning up
 * `Bun.serve` or any real WebSocket — both the parser and the router
 * are pure functions (the router calls handlers, which are passed as
 * deps).
 *
 * Behaviors documented in `docs/behaviors.md` (WS-1, WS-1b, WS-3,
 * PROMPT-20).
 */

import type { ConnState } from "./conn-state.ts";
import type { ClientMessage, MessageSink } from "./ws-protocol.ts";

// ── Parser ───────────────────────────────────────────────────────────────────

export type ParseResult =
  | { ok: true; msg: ClientMessage }
  | { ok: false; error: string };

/**
 * Parses a raw WebSocket frame (string or Buffer) into a `ClientMessage`.
 * On JSON syntax error → `{ ok: false, error: "JSON לא תקין" }` (WS-3).
 */
export function parseClientMessage(raw: string | Buffer): ParseResult {
  let text: string;
  if (typeof raw === "string") {
    text = raw;
  } else {
    try {
      text = raw.toString();
    } catch {
      return { ok: false, error: "JSON לא תקין" };
    }
  }
  try {
    const msg = JSON.parse(text) as ClientMessage;
    return { ok: true, msg };
  } catch {
    return { ok: false, error: "JSON לא תקין" };
  }
}

// ── Router ───────────────────────────────────────────────────────────────────

/**
 * Handlers that the router dispatches to. Each is responsible for one
 * message type. Production wires them to `handleInitMessage`,
 * `handleAudioInput`, `handlePromptText`. Tests pass spies.
 */
export interface MessageHandlers {
  onInit(
    sink: MessageSink,
    state: ConnState,
    msg: Extract<ClientMessage, { type: "init" }>,
  ): Promise<void>;
  onAudio(
    sink: MessageSink,
    state: ConnState,
    msg: Extract<ClientMessage, { type: "audio" }>,
  ): Promise<void>;
  onText(
    sink: MessageSink,
    state: ConnState,
    text: string,
  ): Promise<void>;
  onCancel(state: ConnState): Promise<void>;
}

/**
 * Routes a parsed `ClientMessage` to the appropriate handler.
 * Unknown types → `sink.sendError`. Doesn't catch handler errors —
 * caller wraps in try/catch (so the catch can also pull `state.busy`
 * back to false, etc.).
 */
export async function routeClientMessage(
  sink: MessageSink,
  state: ConnState,
  msg: ClientMessage,
  handlers: MessageHandlers,
): Promise<void> {
  switch (msg.type) {
    case "init":
      await handlers.onInit(sink, state, msg);
      return;
    case "audio":
      await handlers.onAudio(sink, state, msg);
      return;
    case "text":
      await handlers.onText(sink, state, msg.text);
      return;
    case "cancel":
      await handlers.onCancel(state);
      return;
    default:
      sink.sendError(`סוג הודעה לא ידוע: ${(msg as any).type}`);
  }
}

// ── Lifecycle helpers ────────────────────────────────────────────────────────

/**
 * Disposes the bridge if present (close handler). Errors are silently
 * swallowed — close is fire-and-forget; we don't want to crash the
 * server if dispose hangs.
 *
 * WS-5.
 */
export async function disposeConnection(state: ConnState): Promise<void> {
  if (state.bridge) {
    await state.bridge.dispose().catch(() => {});
  }
}

/**
 * Cancel handler — wraps `state.bridge.cancel()` with catch-and-ignore.
 * PROMPT-20.
 */
export async function cancelActivePrompt(state: ConnState): Promise<void> {
  if (!state.bridge) return;
  await state.bridge.cancel().catch(() => {});
}
