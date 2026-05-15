/**
 * Integration tests for `handleAudioInput` — the audio message handler.
 *
 * Uses real loopback bridge + mock STT/recording/Gemini/TTS via deps.
 *
 * Behaviors documented in `docs/behaviors.md` (STT-3, STT-7, STT-8, STT-9,
 * WS-7, REC-4, REC-5).
 */

import { describe, expect, test } from "bun:test";
import {
  AgentSideConnection,
  ndJsonStream,
  type Agent,
} from "@agentclientprotocol/sdk";
import { buildBridgeFromStream } from "../src/acp-bridge.ts";
import { createConnState, type ConnState } from "../src/conn-state.ts";
import { handleAudioInput, type AudioHandlerDeps } from "../src/audio-handler.ts";
import type { MessageSink, ServerMessage } from "../src/ws-protocol.ts";
import type { RecordingInfo } from "../src/recordings.ts";

function recordingSink(): MessageSink & {
  events: ServerMessage[];
  errors: string[];
} {
  const events: ServerMessage[] = [];
  const errors: string[] = [];
  return {
    events,
    errors,
    send(msg) {
      events.push(msg);
    },
    sendError(message) {
      errors.push(message);
      events.push({ type: "error", message });
    },
  };
}

function defaultDeps(overrides: Partial<AudioHandlerDeps> = {}): AudioHandlerDeps {
  return {
    systemPrompt: "[SYS]\n",
    async streamTts(_text, _voiceId, onChunk) {
      onChunk(new Uint8Array([0x00]));
    },
    async translateThought(text) {
      return `HE(${text})`;
    },
    async narrateToolCall(_ctx, tool) {
      return `N(${tool.title})`;
    },
    renderMarkdown(text) {
      return `<p>${text}</p>`;
    },
    async saveRecording() {
      return null; // disabled by default
    },
    async saveRecordingMetadata() {
      return;
    },
    async transcribeAudio(_data, _opts) {
      return "transcribed text";
    },
    sttModelName: "test-model",
    ...overrides,
  };
}

function makeAgent(promptImpl: Agent["prompt"]): Agent {
  return {
    async initialize() {
      return { protocolVersion: 1, agentCapabilities: {}, authMethods: [] };
    },
    async newSession() {
      return { sessionId: "sess-1" };
    },
    async loadSession() {
      return {};
    },
    async authenticate() {
      return {};
    },
    async cancel() {
      return;
    },
    prompt: promptImpl,
  };
}

async function setupAudioHandler(agent: Agent): Promise<{
  state: ConnState;
  sink: ReturnType<typeof recordingSink>;
  agentConn: AgentSideConnection;
  cleanup: () => Promise<void>;
}> {
  const c2a = new TransformStream<Uint8Array, Uint8Array>();
  const a2c = new TransformStream<Uint8Array, Uint8Array>();
  const clientStream = ndJsonStream(c2a.writable, a2c.readable);
  const agentStream = ndJsonStream(a2c.writable, c2a.readable);
  const agentConn = new AgentSideConnection(() => agent, agentStream);
  const bridge = await buildBridgeFromStream(
    clientStream,
    "/test",
    () => [],
    async () => {},
  );
  const state = createConnState();
  state.bridge = bridge;
  await bridge.newSession();
  state.sessionId = bridge.sessionId;
  state.cwd = "/test";
  const sink = recordingSink();
  return {
    state,
    sink,
    agentConn,
    cleanup: async () => bridge.dispose(),
  };
}

describe("handleAudioInput — entry conditions", () => {
  test("bridge=null → 'צריך לשלוח init קודם' — WS-7", async () => {
    const sink = recordingSink();
    const state = createConnState();
    await handleAudioInput(
      sink,
      state,
      { type: "audio", data: "Zm9v" },
      defaultDeps(),
    );
    expect(sink.errors).toContain("צריך לשלוח init קודם");
  });

  test("busy=true → 'כבר בעיבוד הודעה אחרת' — PROMPT-1", async () => {
    const agent = makeAgent(async () => ({ stopReason: "end_turn" }));
    const { state, sink, cleanup } = await setupAudioHandler(agent);
    try {
      state.busy = true;
      await handleAudioInput(
        sink,
        state,
        { type: "audio", data: "Zm9v" },
        defaultDeps(),
      );
      expect(sink.errors).toContain("כבר בעיבוד הודעה אחרת");
    } finally {
      await cleanup();
    }
  });
});

describe("handleAudioInput — STT flow", () => {
  test("transcript is sent before prompt — STT-9", async () => {
    const agent = makeAgent(async () => ({ stopReason: "end_turn" }));
    const { state, sink, cleanup } = await setupAudioHandler(agent);
    try {
      await handleAudioInput(
        sink,
        state,
        { type: "audio", data: "Zm9v", mimeType: "audio/webm" },
        defaultDeps({
          async transcribeAudio() {
            return "hello there";
          },
        }),
      );
      const transcript = sink.events.find((e) => e.type === "transcript") as any;
      expect(transcript).toBeDefined();
      expect(transcript.text).toBe("hello there");
      // transcript appears before thinking (which starts the prompt)
      const tIdx = sink.events.findIndex((e) => e.type === "transcript");
      const thIdx = sink.events.findIndex((e) => e.type === "thinking");
      expect(tIdx).toBeLessThan(thIdx);
    } finally {
      await cleanup();
    }
  });

  test("transcribeAudio receives previousResponse from lastAgentMessage — STT-3", async () => {
    const agent = makeAgent(async () => ({ stopReason: "end_turn" }));
    const { state, sink, cleanup } = await setupAudioHandler(agent);
    try {
      state.lastAgentMessage = "I said hello earlier.";
      let receivedPrev: string | undefined;
      await handleAudioInput(
        sink,
        state,
        { type: "audio", data: "Zm9v" },
        defaultDeps({
          async transcribeAudio(_data, opts) {
            receivedPrev = opts.previousResponse;
            return "user reply";
          },
        }),
      );
      expect(receivedPrev).toBe("I said hello earlier.");
    } finally {
      await cleanup();
    }
  });

  test("transcribeAudio receives mimeType from msg (default audio/webm)", async () => {
    const agent = makeAgent(async () => ({ stopReason: "end_turn" }));
    const { state, sink, cleanup } = await setupAudioHandler(agent);
    try {
      let receivedMime: string | undefined;
      await handleAudioInput(
        sink,
        state,
        { type: "audio", data: "Zm9v" }, // no mimeType → default
        defaultDeps({
          async transcribeAudio(_data, opts) {
            receivedMime = opts.mimeType;
            return "t";
          },
        }),
      );
      expect(receivedMime).toBe("audio/webm");

      // Now with explicit mime
      await handleAudioInput(
        sink,
        state,
        { type: "audio", data: "Zm9v", mimeType: "audio/mp4" },
        defaultDeps({
          async transcribeAudio(_data, opts) {
            receivedMime = opts.mimeType;
            return "t";
          },
        }),
      );
      expect(receivedMime).toBe("audio/mp4");
    } finally {
      await cleanup();
    }
  });

  test("empty transcript → done, no prompt — STT-8", async () => {
    let promptCalled = false;
    const agent = makeAgent(async () => {
      promptCalled = true;
      return { stopReason: "end_turn" };
    });
    const { state, sink, cleanup } = await setupAudioHandler(agent);
    try {
      await handleAudioInput(
        sink,
        state,
        { type: "audio", data: "Zm9v" },
        defaultDeps({
          async transcribeAudio() {
            return ""; // silent audio
          },
        }),
      );
      expect(promptCalled).toBe(false);
      const types = sink.events.map((e) => e.type);
      // We should see: transcript (empty), then done.
      expect(types).toContain("done");
      expect(types).not.toContain("thinking");
    } finally {
      await cleanup();
    }
  });
});

describe("handleAudioInput — recording (REC-4, REC-5)", () => {
  test("saveRecording is called even when disabled (returns null gracefully)", async () => {
    const agent = makeAgent(async () => ({ stopReason: "end_turn" }));
    const { state, sink, cleanup } = await setupAudioHandler(agent);
    try {
      let saveCalled = false;
      await handleAudioInput(
        sink,
        state,
        { type: "audio", data: "Zm9v", mimeType: "audio/webm" },
        defaultDeps({
          async saveRecording(data, mime, sid) {
            saveCalled = true;
            expect(data).toBe("Zm9v");
            expect(mime).toBe("audio/webm");
            expect(sid).toBe(state.sessionId);
            return null;
          },
        }),
      );
      expect(saveCalled).toBe(true);
    } finally {
      await cleanup();
    }
  });

  test("metadata is written after transcript with all required fields — REC-5", async () => {
    const agent = makeAgent(async () => ({ stopReason: "end_turn" }));
    const { state, sink, cleanup } = await setupAudioHandler(agent);
    try {
      const fakeInfo: RecordingInfo = {
        audioPath: "/tmp/a.webm",
        metaPath: "/tmp/a.json",
        timestamp: "2026-01-01T00:00:00Z",
      };
      let metadataWritten: Record<string, unknown> | undefined;

      const metadataPromise = new Promise<void>((resolve) => {
        const deps = defaultDeps({
          async saveRecording() {
            return fakeInfo;
          },
          async saveRecordingMetadata(_info, meta) {
            metadataWritten = meta;
            resolve();
          },
          sttModelName: "test-stt-v2",
          async transcribeAudio() {
            return "the transcript text";
          },
        });
        // Note: handleAudioInput doesn't await the metadata write — it
        // happens fire-and-forget. We let the test resolve once it's done.
        handleAudioInput(
          sink,
          state,
          { type: "audio", data: "Zm9vYmFy", mimeType: "audio/webm" },
          deps,
        );
      });
      await metadataPromise;

      expect(metadataWritten).toBeDefined();
      expect(metadataWritten!.timestamp).toBe(fakeInfo.timestamp);
      expect(metadataWritten!.sessionId).toBe(state.sessionId);
      expect(metadataWritten!.cwd).toBe("/test");
      expect(metadataWritten!.mimeType).toBe("audio/webm");
      // audioSize is the byte length of the decoded base64.
      expect(metadataWritten!.audioSize).toBe(Buffer.from("Zm9vYmFy", "base64").byteLength);
      expect(metadataWritten!.transcript).toBe("the transcript text");
      expect(metadataWritten!.sttModel).toBe("test-stt-v2");
    } finally {
      await cleanup();
    }
  });

  test("saveRecording is fire-and-forget — handler doesn't await it", async () => {
    const agent = makeAgent(async () => ({ stopReason: "end_turn" }));
    const { state, sink, cleanup } = await setupAudioHandler(agent);
    try {
      let saveResolved = false;
      // Create a save that never resolves
      const slowSave = new Promise<RecordingInfo | null>((resolve) => {
        // Will resolve later, but the handler shouldn't wait
        setTimeout(() => {
          saveResolved = true;
          resolve(null);
        }, 500);
      });

      const startTime = Date.now();
      await handleAudioInput(
        sink,
        state,
        { type: "audio", data: "Zm9v" },
        defaultDeps({
          saveRecording: () => slowSave,
        }),
      );
      const elapsed = Date.now() - startTime;
      // Handler should finish well before the 500ms save would resolve.
      expect(elapsed).toBeLessThan(200);
      expect(saveResolved).toBe(false);
    } finally {
      await cleanup();
    }
  });
});
