/**
 * Prompt handler — the heart of the conversation loop.
 *
 * Takes user text, sends it through ACP, streams the model's response
 * back to the client as text chunks + audio, with sentence-boundary
 * chunking, thought translation, and tool-call narration.
 *
 * Extracted from `server.ts` to enable integration tests with mocks
 * (see `tests/prompt-handler.test.ts`). The original `server.ts` is
 * now a thin wrapper that wires real dependencies and calls this.
 *
 * Behaviors documented in `docs/behaviors.md` (PROMPT-1..PROMPT-20).
 */

import type { ConnState } from "./conn-state.ts";
import type { MessageSink } from "./ws-protocol.ts";
import { findSentenceBoundary } from "./sentence-boundary.ts";
import { extractProviderError } from "./provider-error.ts";

/**
 * Callback that streams a TTS chunk back to the client. Receives MP3 bytes;
 * the caller should encode them as base64 if needed.
 */
export type TtsChunkCallback = (chunk: Uint8Array) => void;

/**
 * Dependencies needed by the prompt handler. Production wires real
 * implementations; tests pass mocks.
 */
export interface PromptHandlerDeps {
  /** The system prompt prepended to the first user message of each session. */
  systemPrompt: string;
  /**
   * Streams TTS audio from ElevenLabs (or a mock) — calls `onChunk` for
   * each MP3 chunk. Should resolve when the stream ends. The voiceId is
   * passed through; the handler doesn't decide which voice to use.
   */
  streamTts(
    text: string,
    voiceId: string | undefined,
    onChunk: TtsChunkCallback,
  ): Promise<unknown>;
  /**
   * Translates an English thought to Hebrew. Returns null on failure
   * (timeout / error / empty result) — the caller must skip TTS in that
   * case (see PROMPT-10, GEMINI-5).
   */
  translateThought(text: string): Promise<string | null>;
  /**
   * Narrates a tool call in natural Hebrew given context. May return
   * the raw title as a fallback.
   */
  narrateToolCall(
    ctx: { userMessage: string; recentMessages: string[] },
    tool: { toolCallId: string; kind?: string; title: string },
  ): Promise<string>;
  /** Renders Markdown to sanitized HTML. */
  renderMarkdown(text: string): string;
}

/**
 * Handles a user text input: runs it through the ACP bridge, streams the
 * response to the client via `sink`, and updates `state` (busy flag,
 * lastAgentMessage, recentMessages, firstPromptSent).
 *
 * Throws if `state.bridge` is null (caller should ensure init was sent).
 */
export async function handlePromptText(
  sink: MessageSink,
  state: ConnState,
  text: string,
  deps: PromptHandlerDeps,
): Promise<void> {
  if (!state.bridge) {
    sink.sendError("אין session");
    return;
  }
  state.lastUserText = text;
  state.busy = true;

  try {
    sink.send({ type: "thinking" });

    // Inject system prompt as prefix on the very first prompt of the session.
    const isFirst = !state.firstPromptSent;
    const promptText = isFirst ? deps.systemPrompt + text : text;
    state.firstPromptSent = true;

    // Sequential TTS queue: every queued task chains via `.then(...)`.
    // Order is preserved across message segments, thoughts, and tool titles.
    let ttsQueue: Promise<void> = Promise.resolve();
    let totalMessageChars = 0;
    let streamCounter = 0;

    /** Streams a single TTS segment: audio_start → audio_chunk* → audio_end. */
    const streamSegment = async (
      segText: string,
      kind: "message" | "tool_title" | "thought",
    ): Promise<void> => {
      const streamId = `s${Date.now().toString(36)}-${streamCounter++}`;
      try {
        sink.send({ type: "audio_start", streamId, kind });
        await deps.streamTts(
          segText,
          state.voiceId ?? undefined,
          (chunk) => {
            sink.send({
              type: "audio_chunk",
              streamId,
              data: Buffer.from(chunk).toString("base64"),
            });
          },
        );
        sink.send({ type: "audio_end", streamId });
      } catch (e) {
        console.error(
          `[ws] TTS streaming נכשל (${kind}): ${(e as Error).message}`,
        );
        sink.send({ type: "audio_end", streamId });
      }
    };
    const queueTts = (segText: string, kind: "message" | "tool_title") => {
      ttsQueue = ttsQueue.then(() => streamSegment(segText, kind));
    };

    // Accumulating buffer of "message" chunks — split into TTS-able segments
    // at sentence boundaries.
    let messageBuffer = "";
    const flushMessage = () => {
      const t = messageBuffer.trim();
      messageBuffer = "";
      if (!t) return;
      totalMessageChars += t.length;
      // PROMPT-9: overwrite (not accumulate). Only the LAST segment is the
      // STT context — that's what the user just heard.
      state.lastAgentMessage = t;
      // FIFO max 3 — context for `narrateToolCall`.
      state.recentMessages.push(t);
      if (state.recentMessages.length > 3) state.recentMessages.shift();
      // Render markdown first so the UI shows the pretty version immediately.
      try {
        const html = deps.renderMarkdown(t);
        sink.send({ type: "message_rendered", html, source: "live" });
      } catch (e) {
        console.error(`[ws] render נכשל: ${(e as Error).message}`);
      }
      console.log(`[ws] TTS message segment (${t.length} chars)`);
      queueTts(t, "message");
    };

    // Accumulating buffer of "thought" chunks.
    // flushThought: translate via Gemini → send text_chunk thought_translation
    // → TTS with kind "thought" (frontend links to the original thought bubble).
    // If translation returns null → skip text_chunk AND TTS entirely.
    let thoughtBuffer = "";
    const flushThought = () => {
      const t = thoughtBuffer.trim();
      thoughtBuffer = "";
      if (!t) return;
      console.log(`[ws] thought segment (${t.length} chars) → תרגום + TTS`);
      ttsQueue = ttsQueue.then(async () => {
        const hebrew = await deps.translateThought(t);
        if (hebrew === null) {
          console.log(
            `[ws] thought translation failed — דילוג על TTS לסגמנט הזה`,
          );
          return;
        }
        sink.send({
          type: "text_chunk",
          text: hebrew,
          kind: "thought_translation",
        });
        await streamSegment(hebrew, "thought");
      });
    };

    console.log(`[ws] prompt (${isFirst ? "first" : "follow-up"}): ${text}`);

    // Counters for end-of-prompt logging (debug)
    let cntMessage = 0;
    let cntThought = 0;
    let cntUser = 0;
    const toolCreates: Array<{ id: string; kind?: string; title: string }> = [];
    let toolUpdates = 0;

    await state.bridge.prompt(promptText, {
      onChunk: (chunk, kind) => {
        // user_message_chunk only arrives in history (loadSession), not here.
        if (kind === "user_message") {
          cntUser += chunk.length;
          return;
        }
        if (kind === "message") cntMessage += chunk.length;
        else if (kind === "thought") cntThought += chunk.length;
        sink.send({ type: "text_chunk", text: chunk, kind });
        if (kind === "message") {
          // If a thought was being accumulated, flush it first.
          if (thoughtBuffer.length > 0) flushThought();
          messageBuffer += chunk;
          // Sentence-boundary chunking — start TTS as early as possible.
          let boundary = findSentenceBoundary(messageBuffer);
          while (boundary !== -1) {
            const head = messageBuffer.slice(0, boundary);
            const rest = messageBuffer.slice(boundary);
            messageBuffer = head;
            flushMessage(); // sends head, resets messageBuffer to ""
            messageBuffer = rest;
            boundary = findSentenceBoundary(messageBuffer);
          }
        } else if (kind === "thought") {
          // Thought arrived mid-stream — flush any pending message
          // (for bubble separation in the frontend).
          if (messageBuffer.length > 0) flushMessage();
          thoughtBuffer += chunk;
          // Same sentence-boundary chunking for thoughts (PROMPT analog).
          let boundary = findSentenceBoundary(thoughtBuffer);
          while (boundary !== -1) {
            const head = thoughtBuffer.slice(0, boundary);
            const rest = thoughtBuffer.slice(boundary);
            thoughtBuffer = head;
            flushThought();
            thoughtBuffer = rest;
            boundary = findSentenceBoundary(thoughtBuffer);
          }
        }
      },
      onToolCall: (event) => {
        if (event.event === "create") {
          toolCreates.push({
            id: event.toolCallId,
            kind: event.toolKind,
            title: event.title ?? "",
          });
          console.log(
            `[ws] tool_call create: kind=${event.toolKind ?? "?"} title="${event.title ?? "(empty)"}" status=${event.status ?? "?"}`,
          );
        } else {
          toolUpdates++;
          console.log(
            `[ws] tool_call update: id=${event.toolCallId.slice(0, 8)} status=${event.status ?? "?"}`,
          );
        }
        sink.send({
          type: "tool_call",
          event: event.event,
          toolCallId: event.toolCallId,
          title: event.title,
          toolKind: event.toolKind,
          status: event.status,
        });
        // tool_call create — close pending message + thought, then narrate.
        if (event.event === "create") {
          flushMessage();
          flushThought();
          const rawTitle = event.title?.trim();
          if (rawTitle) {
            console.log(`[ws] narrate tool (raw: ${rawTitle})`);
            // PROMPT-12: snapshot context at create-time, so concurrent
            // updates to recentMessages don't change the narration target.
            const userMessage = state.lastUserText ?? "";
            const recentSnapshot = state.recentMessages.slice(-3);
            const toolForNarrate = {
              toolCallId: event.toolCallId,
              kind: event.toolKind,
              title: rawTitle,
            };
            ttsQueue = ttsQueue.then(async () => {
              let narrate = rawTitle;
              try {
                narrate = await deps.narrateToolCall(
                  { userMessage, recentMessages: recentSnapshot },
                  toolForNarrate,
                );
              } catch (e) {
                console.error(
                  `[ws] narrate נכשל: ${(e as Error).message}`,
                );
              }
              await streamSegment(narrate, "tool_title");
            });
          }
        }
      },
    });

    // End-of-turn — flush whatever's left in either buffer.
    flushMessage();
    flushThought();

    console.log(
      `[ws] סיכום prompt: message=${cntMessage}ch thought=${cntThought}ch user_msg=${cntUser}ch tools=${toolCreates.length}create+${toolUpdates}update`,
    );
    if (toolCreates.length > 0) {
      console.log(
        `[ws]   tools: ${toolCreates.map((t) => `${t.kind ?? "?"}/"${t.title}"`).join(", ")}`,
      );
    }

    if (totalMessageChars === 0) {
      // The model produced no message text. Could be a swallowed provider
      // error (PROMPT-17, PROMPT-19) — try to extract it from acp stderr.
      const stderrLines = state.bridge.getRecentStderr();
      const providerError = extractProviderError(stderrLines);
      if (providerError) {
        console.log(`[ws] תשובה ריקה — שגיאת provider: ${providerError}`);
        sink.sendError(`שגיאת provider: ${providerError}`);
      } else if (cntThought > 0 || toolCreates.length > 0) {
        console.log(
          `[ws] תשובה ריקה — היו thoughts/tools (${cntThought}ch, ${toolCreates.length}t)`,
        );
        sink.sendError(
          "המודל ביצע פעולות אבל לא חזר עם תשובה מילולית. נסי לבקש סיכום.",
        );
      } else {
        console.log(`[ws] תשובה ריקה — מדלגים על TTS`);
        sink.sendError("המודל לא ענה. נסי לנסח את השאלה אחרת.");
      }
    }

    // PROMPT-18: send `done` immediately — don't wait for ttsQueue.
    sink.send({ type: "done" });
  } finally {
    state.busy = false;
  }
}
