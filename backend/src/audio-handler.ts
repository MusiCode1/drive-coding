/**
 * Audio handler — handles `audio` WebSocket messages from the client.
 *
 * Flow:
 *   1. Background: kick off recording save (non-blocking).
 *   2. STT: transcribe the audio → text (uses previous agent message as context).
 *   3. Send transcript to client.
 *   4. Background: write recording metadata once STT resolved.
 *   5. If transcript is empty → send `done` and return.
 *   6. Delegate to `handlePromptText` with the transcript.
 *
 * Behaviors documented in `docs/behaviors.md` (STT-3, STT-7, STT-8, STT-9,
 * WS-7, REC-4, REC-5, PROMPT-1).
 */

import type { ConnState } from "./conn-state.ts";
import type { MessageSink } from "./ws-protocol.ts";
import { handlePromptText, type PromptHandlerDeps } from "./prompt-handler.ts";
import type { RecordingInfo } from "./recordings.ts";

export interface AudioHandlerDeps extends PromptHandlerDeps {
  /**
   * Save raw audio to disk (typically background). Returns `null` if
   * recordings are disabled or the save failed. Should never throw.
   */
  saveRecording(
    audioBase64: string,
    mimeType: string,
    sessionId: string | null,
  ): Promise<RecordingInfo | null>;
  /**
   * Write metadata sidecar JSON next to the audio file. Called after STT
   * so transcript can be included. Should never throw.
   */
  saveRecordingMetadata(
    info: RecordingInfo,
    meta: Record<string, unknown>,
  ): Promise<void>;
  /**
   * Run STT — convert base64 audio to text. May receive `previousResponse`
   * as conversational context.
   */
  transcribeAudio(
    audioBase64: string,
    opts: { mimeType: string; previousResponse?: string },
  ): Promise<string>;
  /** Name of the STT model — included in metadata. */
  sttModelName: string;
}

/** The `audio` WebSocket message payload. */
export interface AudioMessage {
  type: "audio";
  data: string; // base64
  mimeType?: string;
}

/**
 * Handles an `audio` message from the client.
 */
export async function handleAudioInput(
  sink: MessageSink,
  state: ConnState,
  msg: AudioMessage,
  deps: AudioHandlerDeps,
): Promise<void> {
  if (!state.bridge) {
    sink.sendError("צריך לשלוח init קודם");
    return;
  }
  if (state.busy) {
    sink.sendError("כבר בעיבוד הודעה אחרת");
    return;
  }

  // 0. Recording save (background, non-blocking — REC-4).
  const mimeType = msg.mimeType ?? "audio/webm";
  const recPromise = deps.saveRecording(msg.data, mimeType, state.sessionId);

  // 1. STT — passes previousResponse as context (STT-3).
  console.log(`[ws] STT (${msg.data.length} chars base64)`);
  const transcript = await deps.transcribeAudio(msg.data, {
    mimeType,
    previousResponse: state.lastAgentMessage ?? undefined,
  });
  sink.send({ type: "transcript", text: transcript });

  // 2. Metadata write — fire-and-forget so it never delays the prompt.
  recPromise.then(async (info) => {
    if (!info) return;
    await deps.saveRecordingMetadata(info, {
      timestamp: info.timestamp,
      sessionId: state.sessionId,
      cwd: state.cwd,
      mimeType,
      audioSize: Buffer.from(msg.data, "base64").byteLength,
      transcript,
      sttModel: deps.sttModelName,
    });
  });

  // 3. Empty transcript → done, no prompt (STT-8).
  if (!transcript) {
    sink.send({ type: "done" });
    return;
  }

  // 4. Delegate to the prompt handler.
  await handlePromptText(sink, state, transcript, deps);
}
