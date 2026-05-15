/**
 * Integration tests for `handlePromptText` — the heart of the conversation
 * loop.
 *
 * Uses the ACP loopback pattern from `acp-bridge.test.ts` for the bridge,
 * and direct mocks for TTS / Gemini / Markdown via the `PromptHandlerDeps`
 * interface.
 *
 * Behaviors documented in `docs/behaviors.md` (PROMPT-1..PROMPT-20, plus
 * cross-refs to ACP-7, GEMINI-5, MARKDOWN, etc.).
 */

import { describe, expect, test } from "bun:test";
import {
  AgentSideConnection,
  ndJsonStream,
  type Agent,
} from "@agentclientprotocol/sdk";
import { buildBridgeFromStream } from "../src/acp-bridge.ts";
import { createConnState, type ConnState } from "../src/conn-state.ts";
import { handlePromptText, type PromptHandlerDeps } from "../src/prompt-handler.ts";
import type { MessageSink, ServerMessage } from "../src/ws-protocol.ts";

// ── Test harness ─────────────────────────────────────────────────────────────

/**
 * A `MessageSink` that collects every message into an array.
 * Tests then assert on the recorded events.
 */
function recordingSink(): MessageSink & { events: ServerMessage[]; errors: string[] } {
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

/**
 * Default `PromptHandlerDeps` — no-op TTS, identity translation, raw-title
 * narration, identity markdown. Tests override individual fields.
 */
function defaultDeps(overrides: Partial<PromptHandlerDeps> = {}): PromptHandlerDeps {
  return {
    systemPrompt: "[SYSTEM PROMPT]\n",
    async streamTts(_text, _voiceId, onChunk) {
      // Default: produce one tiny chunk so the test can observe audio_*.
      onChunk(new Uint8Array([0x00]));
    },
    async translateThought(text) {
      return `HE(${text})`;
    },
    async narrateToolCall(_ctx, tool) {
      return `NARRATE(${tool.title})`;
    },
    renderMarkdown(text) {
      return `<p>${text}</p>`;
    },
    ...overrides,
  };
}

/**
 * Wires up the loopback bridge, fresh ConnState, recording sink — ready
 * to run `handlePromptText`. Returns the things tests need.
 */
async function setupHandler(agent: Agent): Promise<{
  state: ConnState;
  sink: ReturnType<typeof recordingSink>;
  agentConn: AgentSideConnection;
  cleanup: () => Promise<void>;
}> {
  const clientToAgent = new TransformStream<Uint8Array, Uint8Array>();
  const agentToClient = new TransformStream<Uint8Array, Uint8Array>();
  const clientStream = ndJsonStream(
    clientToAgent.writable,
    agentToClient.readable,
  );
  const agentStream = ndJsonStream(
    agentToClient.writable,
    clientToAgent.readable,
  );
  const agentConn = new AgentSideConnection(() => agent, agentStream);

  // stderrLines is mutable so tests can inject error patterns for PROMPT-17.
  const stderrLines: string[] = [];
  const bridge = await buildBridgeFromStream(
    clientStream,
    "/test",
    () => [...stderrLines],
    async () => {},
  );

  const state = createConnState();
  state.bridge = bridge;
  await bridge.newSession();
  state.sessionId = bridge.sessionId;

  const sink = recordingSink();

  return {
    state,
    sink,
    agentConn,
    cleanup: async () => {
      await bridge.dispose();
    },
  };
}

/** Minimal Agent — gets a `prompt` impl per test. */
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

// ── Tests ────────────────────────────────────────────────────────────────────

describe("handlePromptText — basic flow", () => {
  test("sends `thinking` immediately, then `done` at the end — PROMPT-2, PROMPT-18", async () => {
    const agent = makeAgent(async () => ({ stopReason: "end_turn" }));
    const { state, sink, cleanup } = await setupHandler(agent);
    try {
      await handlePromptText(sink, state, "hello", defaultDeps());

      const types = sink.events.map((e) => e.type);
      // First should be 'thinking', then (no message → error), then 'done'.
      expect(types[0]).toBe("thinking");
      expect(types[types.length - 1]).toBe("done");
    } finally {
      await cleanup();
    }
  });

  test("busy flag is set during prompt and cleared at end — PROMPT-1", async () => {
    let busyDuring: boolean | undefined;
    const agent = makeAgent(async () => {
      // captured by closure — state is visible via the test.
      return { stopReason: "end_turn" };
    });
    const { state, sink, cleanup } = await setupHandler(agent);
    try {
      const promise = handlePromptText(sink, state, "x", defaultDeps());
      // state.busy should be true synchronously after we call.
      busyDuring = state.busy;
      await promise;
      expect(busyDuring).toBe(true);
      expect(state.busy).toBe(false);
    } finally {
      await cleanup();
    }
  });

  test("busy is cleared even if bridge.prompt throws — PROMPT-1 finally", async () => {
    const agent = makeAgent(async () => {
      throw new Error("simulated agent error");
    });
    const { state, sink, cleanup } = await setupHandler(agent);
    try {
      await expect(
        handlePromptText(sink, state, "x", defaultDeps()),
      ).rejects.toThrow();
      expect(state.busy).toBe(false);
    } finally {
      await cleanup();
    }
  });

  test("bridge=null → sendError + early return — WS-7", async () => {
    const sink = recordingSink();
    const state = createConnState(); // no bridge attached
    await handlePromptText(sink, state, "x", defaultDeps());
    expect(sink.errors).toContain("אין session");
    // No `thinking`, no `done` — handler returns immediately.
    expect(sink.events.map((e) => e.type)).toEqual(["error"]);
  });

  test("lastUserText is set before prompt — used as context for tools", async () => {
    const agent = makeAgent(async () => ({ stopReason: "end_turn" }));
    const { state, sink, cleanup } = await setupHandler(agent);
    try {
      await handlePromptText(sink, state, "what is the date?", defaultDeps());
      expect(state.lastUserText).toBe("what is the date?");
    } finally {
      await cleanup();
    }
  });
});

describe("handlePromptText — system prompt injection (PROMPT-3, PROMPT-4)", () => {
  test("first prompt has system prompt prefix; second does not", async () => {
    const captured: string[] = [];
    const agent = makeAgent(async (params) => {
      const text = (params.prompt[0] as any).text;
      captured.push(text);
      return { stopReason: "end_turn" };
    });
    const { state, sink, cleanup } = await setupHandler(agent);
    try {
      await handlePromptText(sink, state, "hello", defaultDeps());
      await handlePromptText(sink, state, "world", defaultDeps());

      expect(captured[0]).toBe("[SYSTEM PROMPT]\nhello");
      expect(captured[1]).toBe("world");
      expect(state.firstPromptSent).toBe(true);
    } finally {
      await cleanup();
    }
  });
});

describe("handlePromptText — message streaming (PROMPT-8, PROMPT-9, PROMPT-16)", () => {
  test("single short message → text_chunk + message_rendered + audio_start/chunk/end + done", async () => {
    const agent = makeAgent(async function (params) {
      const sid = params.sessionId;
      const update = {
        sessionUpdate: "agent_message_chunk" as const,
        content: { type: "text" as const, text: "hello world. " },
      };
      // The agent connection lives on the closure of the test below — we
      // need to use the AgentSideConnection from setupHandler. Workaround:
      // attach it as a prop on `agent` itself before the test starts.
      // (Done in test body via a setup pattern.)
      await (agent as any)._conn.sessionUpdate({ sessionId: sid, update });
      return { stopReason: "end_turn" };
    });
    const { state, sink, agentConn, cleanup } = await setupHandler(agent);
    (agent as any)._conn = agentConn;
    try {
      await handlePromptText(sink, state, "x", defaultDeps());

      const types = sink.events.map((e) => e.type);
      // Order: thinking → text_chunk → message_rendered → audio_start → audio_chunk → audio_end → done
      expect(types).toContain("thinking");
      expect(types).toContain("text_chunk");
      expect(types).toContain("message_rendered");
      expect(types).toContain("audio_start");
      expect(types).toContain("audio_chunk");
      expect(types).toContain("audio_end");
      expect(types[types.length - 1]).toBe("done");

      // Specific assertions:
      const textChunk = sink.events.find((e) => e.type === "text_chunk") as any;
      expect(textChunk.text).toBe("hello world. ");
      expect(textChunk.kind).toBe("message");

      const rendered = sink.events.find((e) => e.type === "message_rendered") as any;
      expect(rendered.html).toBe("<p>hello world.</p>"); // trimmed before render
      expect(rendered.source).toBe("live");

      const audioStart = sink.events.find((e) => e.type === "audio_start") as any;
      expect(audioStart.kind).toBe("message");
    } finally {
      await cleanup();
    }
  });

  test("multiple sentences in one chunk → batched flush (findSentenceBoundary returns LAST boundary)", async () => {
    const agent = makeAgent(async function (params) {
      await (agent as any)._conn.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: "First sentence. Second sentence. Third.",
          },
        },
      });
      return { stopReason: "end_turn" };
    });
    const { state, sink, agentConn, cleanup } = await setupHandler(agent);
    (agent as any)._conn = agentConn;
    try {
      await handlePromptText(sink, state, "x", defaultDeps());

      // findSentenceBoundary returns the LAST boundary, so the first two
      // complete sentences ("First sentence. Second sentence. ") flush
      // together as one segment. Then the trailing "Third." (no whitespace
      // after) is flushed at end-of-turn. Total: 2 renders.
      const renders = sink.events.filter((e) => e.type === "message_rendered") as any[];
      expect(renders.length).toBe(2);
      expect(renders[0].html).toBe("<p>First sentence. Second sentence.</p>");
      expect(renders[1].html).toBe("<p>Third.</p>");
    } finally {
      await cleanup();
    }
  });

  test("lastAgentMessage gets OVERWRITTEN (not accumulated) — PROMPT-9", async () => {
    const agent = makeAgent(async function (params) {
      await (agent as any)._conn.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "First. Second. Third final." },
        },
      });
      return { stopReason: "end_turn" };
    });
    const { state, sink, agentConn, cleanup } = await setupHandler(agent);
    (agent as any)._conn = agentConn;
    try {
      await handlePromptText(sink, state, "x", defaultDeps());
      // Only the LAST segment should be in lastAgentMessage — STT-3 context.
      expect(state.lastAgentMessage).toBe("Third final.");
    } finally {
      await cleanup();
    }
  });

  test("recentMessages FIFO cap of 3 — segments overflow gets shifted out", async () => {
    // To test the FIFO cap we need 4+ separate flushes. The cleanest way
    // is 4 separate chunks (each triggers an in-chunk flush since each
    // ends with `. `), but findSentenceBoundary batches anyway. Easier:
    // 4 separate prompts. recentMessages persists across prompts.
    const agent = makeAgent(async function (params) {
      const text = (params.prompt[0] as any).text;
      // Use the same text the test wants
      await (agent as any)._conn.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `${text}. ` },
        },
      });
      return { stopReason: "end_turn" };
    });
    const { state, sink, agentConn, cleanup } = await setupHandler(agent);
    (agent as any)._conn = agentConn;
    try {
      for (const t of ["One", "Two", "Three", "Four"]) {
        await handlePromptText(sink, state, t, defaultDeps());
      }
      // After 4 flushes, FIFO holds only the last 3.
      expect(state.recentMessages).toEqual(["Two.", "Three.", "Four."]);
    } finally {
      await cleanup();
    }
  });
});

describe("handlePromptText — thought flow (PROMPT-10, PROMPT-11, GEMINI-5)", () => {
  test("thought chunk → translateThought → text_chunk thought_translation + audio kind=thought", async () => {
    const agent = makeAgent(async function (params) {
      await (agent as any)._conn.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "I think hard. " },
        },
      });
      return { stopReason: "end_turn" };
    });
    const { state, sink, agentConn, cleanup } = await setupHandler(agent);
    (agent as any)._conn = agentConn;
    try {
      await handlePromptText(sink, state, "x", defaultDeps());

      // Should see a thought_translation text_chunk and an audio_start with kind=thought.
      const trans = sink.events.find(
        (e) =>
          e.type === "text_chunk" &&
          (e as any).kind === "thought_translation",
      ) as any;
      expect(trans).toBeDefined();
      expect(trans.text).toBe("HE(I think hard.)");

      const thoughtAudio = sink.events.find(
        (e) => e.type === "audio_start" && (e as any).kind === "thought",
      );
      expect(thoughtAudio).toBeDefined();
    } finally {
      await cleanup();
    }
  });

  test("translateThought returns null → skip both text_chunk and TTS — GEMINI-5", async () => {
    const agent = makeAgent(async function (params) {
      await (agent as any)._conn.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "lost thought. " },
        },
      });
      return { stopReason: "end_turn" };
    });
    const { state, sink, agentConn, cleanup } = await setupHandler(agent);
    (agent as any)._conn = agentConn;
    try {
      await handlePromptText(
        sink,
        state,
        "x",
        defaultDeps({ async translateThought() { return null; } }),
      );

      // No thought_translation text_chunk should appear.
      const trans = sink.events.find(
        (e) =>
          e.type === "text_chunk" &&
          (e as any).kind === "thought_translation",
      );
      expect(trans).toBeUndefined();

      // No audio_start with kind=thought either.
      const thoughtAudio = sink.events.find(
        (e) => e.type === "audio_start" && (e as any).kind === "thought",
      );
      expect(thoughtAudio).toBeUndefined();

      // But the original thought text_chunk (kind="thought") was still sent.
      const original = sink.events.find(
        (e) => e.type === "text_chunk" && (e as any).kind === "thought",
      );
      expect(original).toBeDefined();
    } finally {
      await cleanup();
    }
  });

  test("kind transition (thought→message) flushes the thought buffer — PROMPT-11", async () => {
    const agent = makeAgent(async function (params) {
      const conn = (agent as any)._conn;
      await conn.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "thinking" },
        },
      });
      // No sentence boundary in the thought — buffer not yet flushed by chunking.
      await conn.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "answer. " },
        },
      });
      return { stopReason: "end_turn" };
    });
    const { state, sink, agentConn, cleanup } = await setupHandler(agent);
    (agent as any)._conn = agentConn;
    try {
      await handlePromptText(sink, state, "x", defaultDeps());

      // Both thought and message should have gotten their TTS — separately.
      const audioStarts = sink.events.filter((e) => e.type === "audio_start") as any[];
      const kinds = audioStarts.map((e) => e.kind);
      expect(kinds).toContain("thought");
      expect(kinds).toContain("message");
    } finally {
      await cleanup();
    }
  });
});

describe("handlePromptText — tool calls (PROMPT-12)", () => {
  test("tool_call create → narration via deps.narrateToolCall + tool_title TTS", async () => {
    const agent = makeAgent(async function (params) {
      await (agent as any)._conn.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "tc-1",
          title: "Reading README",
          kind: "read",
          status: "pending",
        },
      });
      return { stopReason: "end_turn" };
    });
    const { state, sink, agentConn, cleanup } = await setupHandler(agent);
    (agent as any)._conn = agentConn;
    try {
      let receivedCtx: any;
      let receivedTool: any;
      await handlePromptText(
        sink,
        state,
        "what's in the readme?",
        defaultDeps({
          async narrateToolCall(ctx, tool) {
            receivedCtx = ctx;
            receivedTool = tool;
            return `Reading the readme file`;
          },
        }),
      );

      // The narration callback received the snapshot.
      expect(receivedCtx.userMessage).toBe("what's in the readme?");
      expect(receivedTool.title).toBe("Reading README");
      expect(receivedTool.kind).toBe("read");

      // tool_call event was forwarded to the client.
      const toolEvent = sink.events.find((e) => e.type === "tool_call") as any;
      expect(toolEvent.event).toBe("create");
      expect(toolEvent.toolCallId).toBe("tc-1");

      // A tool_title audio segment was streamed.
      const toolAudio = sink.events.find(
        (e) => e.type === "audio_start" && (e as any).kind === "tool_title",
      );
      expect(toolAudio).toBeDefined();
    } finally {
      await cleanup();
    }
  });

  test("tool_call without title → no narration, no TTS", async () => {
    const agent = makeAgent(async function (params) {
      await (agent as any)._conn.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "tc-empty",
          title: "",
          status: "pending",
        },
      });
      return { stopReason: "end_turn" };
    });
    const { state, sink, agentConn, cleanup } = await setupHandler(agent);
    (agent as any)._conn = agentConn;
    try {
      let narrateCalled = false;
      await handlePromptText(
        sink,
        state,
        "x",
        defaultDeps({
          async narrateToolCall() {
            narrateCalled = true;
            return "should not happen";
          },
        }),
      );
      expect(narrateCalled).toBe(false);
      // No tool_title audio either.
      const toolAudio = sink.events.find(
        (e) => e.type === "audio_start" && (e as any).kind === "tool_title",
      );
      expect(toolAudio).toBeUndefined();
    } finally {
      await cleanup();
    }
  });
});

describe("handlePromptText — empty response handling (PROMPT-17)", () => {
  test("0 message chars + 0 thoughts/tools → 'המודל לא ענה' error", async () => {
    const agent = makeAgent(async () => ({ stopReason: "end_turn" }));
    const { state, sink, cleanup } = await setupHandler(agent);
    try {
      await handlePromptText(sink, state, "x", defaultDeps());
      expect(sink.errors[0]).toContain("המודל לא ענה");
    } finally {
      await cleanup();
    }
  });

  test("0 message chars + thoughts → 'ביצע פעולות' error", async () => {
    const agent = makeAgent(async function (params) {
      await (agent as any)._conn.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "internal thinking" },
        },
      });
      return { stopReason: "end_turn" };
    });
    const { state, sink, agentConn, cleanup } = await setupHandler(agent);
    (agent as any)._conn = agentConn;
    try {
      await handlePromptText(sink, state, "x", defaultDeps());
      expect(sink.errors[0]).toContain("ביצע פעולות");
    } finally {
      await cleanup();
    }
  });

  test("error is followed by done (PROMPT-17 + PROMPT-18)", async () => {
    const agent = makeAgent(async () => ({ stopReason: "end_turn" }));
    const { state, sink, cleanup } = await setupHandler(agent);
    try {
      await handlePromptText(sink, state, "x", defaultDeps());
      const types = sink.events.map((e) => e.type);
      const errorIdx = types.indexOf("error");
      const doneIdx = types.indexOf("done");
      expect(errorIdx).toBeGreaterThanOrEqual(0);
      expect(doneIdx).toBeGreaterThan(errorIdx);
    } finally {
      await cleanup();
    }
  });
});

