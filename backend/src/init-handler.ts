/**
 * Init handler — handles `init` WebSocket messages from the client.
 *
 * Flow:
 *   1. If already initialized → error.
 *   2. Record voice + cwd in state.
 *   3. Create AcpBridge (production: spawn; tests: stub).
 *   4. Either `loadSession(sessionId)` with history streaming, or
 *      `newSession()`. Sets `firstPromptSent=true` for loaded sessions.
 *   5. If model param given and differs from current → setModel.
 *   6. Send `ready` with availableModels + currentModelId.
 *
 * Behaviors documented in `docs/behaviors.md` (WS-6, WS-8, WS-9, WS-10,
 * PROMPT-4, UI-HIST-5, ACP-14, ACP-17).
 */

import type { AcpBridge } from "./acp-bridge.ts";
import type { ConnState } from "./conn-state.ts";
import type { MessageSink } from "./ws-protocol.ts";

export interface InitHandlerDeps {
  /**
   * Create a new AcpBridge for the given cwd. In production this spawns
   * opencode acp; in tests this can return a stub.
   */
  createBridge(opts: {
    cwd: string;
    printAgentLogs?: boolean;
  }): Promise<AcpBridge>;
  /** Render Markdown → HTML for history message segments. */
  renderMarkdown(text: string): string;
  /** Should the agent print its logs to stderr? Mapped from VOICE_ACP_VERBOSE. */
  printAgentLogs: boolean;
}

/** The `init` WebSocket message payload. */
export interface InitMessage {
  type: "init";
  cwd: string;
  sessionId?: string;
  model?: string;
  voice?: string;
}

/**
 * Handles an `init` message from the client.
 */
export async function handleInitMessage(
  sink: MessageSink,
  state: ConnState,
  msg: InitMessage,
  deps: InitHandlerDeps,
): Promise<void> {
  if (state.bridge) {
    sink.sendError("כבר אותחל");
    return;
  }

  state.voiceId = msg.voice ?? null;
  state.cwd = msg.cwd;

  console.log(
    `[ws] init cwd=${msg.cwd} session=${msg.sessionId ?? "(new)"} voice=${state.voiceId ?? "(default)"}`,
  );
  state.bridge = await deps.createBridge({
    cwd: msg.cwd,
    printAgentLogs: deps.printAgentLogs,
  });

  let sessionResult;
  if (msg.sessionId) {
    // Load existing session — stream history to client as it replays.
    // The system prompt is part of the history, so mark it as already sent
    // (PROMPT-4).
    state.firstPromptSent = true;
    sink.send({ type: "history_start" });

    // Markdown buffer for message segments in history (mirrors flushMessage).
    let historyMessageBuffer = "";
    const flushHistoryMessage = () => {
      const t = historyMessageBuffer.trim();
      historyMessageBuffer = "";
      if (!t) return;
      try {
        const html = deps.renderMarkdown(t);
        sink.send({ type: "message_rendered", html, source: "history" });
      } catch (e) {
        console.error(
          `[ws] render history נכשל: ${(e as Error).message}`,
        );
      }
    };

    sessionResult = await state.bridge.loadSession(msg.sessionId, {
      onChunk: (chunk, kind) => {
        sink.send({ type: "history_chunk", text: chunk, kind });
        if (kind === "message") {
          historyMessageBuffer += chunk;
        } else if (
          (kind === "thought" || kind === "user_message") &&
          historyMessageBuffer.length > 0
        ) {
          flushHistoryMessage();
        }
      },
      onToolCall: (event) => {
        sink.send({
          type: "history_tool_call",
          event: event.event,
          toolCallId: event.toolCallId,
          title: event.title,
          toolKind: event.toolKind,
          status: event.status,
        });
        if (event.event === "create" && historyMessageBuffer.length > 0) {
          flushHistoryMessage();
        }
      },
    });
    // Final flush of anything that didn't trigger a kind transition.
    flushHistoryMessage();
    sink.send({ type: "history_done" });
  } else {
    sessionResult = await state.bridge.newSession();
  }

  // Model override (WS-9).
  if (msg.model && msg.model !== sessionResult.currentModelId) {
    try {
      await state.bridge.setModel(msg.model);
      sessionResult.currentModelId = msg.model;
    } catch {
      sink.sendError(
        `לא ניתן להגדיר model=${msg.model}; נשאר עם ברירת המחדל`,
      );
    }
  }

  state.sessionId = sessionResult.sessionId;

  sink.send({
    type: "ready",
    sessionId: sessionResult.sessionId,
    availableModels: sessionResult.availableModels,
    currentModelId: sessionResult.currentModelId,
  });
}
