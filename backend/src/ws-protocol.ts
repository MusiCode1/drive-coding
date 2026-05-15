/**
 * WebSocket message types — protocol between frontend and backend.
 *
 * Extracted from `server.ts` so that handlers can be tested independently
 * of `Bun.serve`. See `docs/spec.md` §4 for the full protocol description.
 */

export type ClientMessage =
  | {
      type: "init";
      cwd: string;
      sessionId?: string;
      model?: string;
      voice?: string;
    }
  | { type: "audio"; data: string; mimeType?: string }
  | { type: "text"; text: string } // debug — skips STT
  | { type: "cancel" };

export type ServerMessage =
  | {
      type: "ready";
      sessionId: string;
      availableModels?: Array<{
        modelId: string;
        name: string;
        description?: string;
      }>;
      currentModelId?: string;
    }
  | { type: "transcript"; text: string }
  | { type: "thinking" }
  | {
      type: "text_chunk";
      text: string;
      kind: "message" | "thought" | "thought_translation";
    }
  | {
      type: "tool_call";
      event: "create" | "update";
      toolCallId: string;
      title: string;
      toolKind?: string;
      status?: string;
    }
  | {
      type: "audio_ready";
      data: string; // base64 MP3
      kind: "message" | "tool_title";
    }
  // streaming TTS — replaces audio_ready for live messages
  | {
      type: "audio_start";
      streamId: string;
      kind: "message" | "tool_title" | "thought";
    }
  | { type: "audio_chunk"; streamId: string; data: string } // base64 MP3 chunk
  | { type: "audio_end"; streamId: string }
  // Sent when a message segment is rendered to HTML via markdown
  | { type: "message_rendered"; html: string; source: "live" | "history" }
  | { type: "done" }
  | { type: "error"; message: string }
  // History — sent during loadSession of an existing session
  | { type: "history_start" }
  | {
      type: "history_chunk";
      text: string;
      kind: "message" | "thought" | "user_message";
    }
  | {
      type: "history_tool_call";
      event: "create" | "update";
      toolCallId: string;
      title: string;
      toolKind?: string;
      status?: string;
    }
  | { type: "history_done" };

/**
 * A sink that handlers use to send messages to the client. Production
 * implementations send over a real WebSocket; tests collect into an array.
 */
export interface MessageSink {
  send(msg: ServerMessage): void;
  sendError(message: string): void;
}
