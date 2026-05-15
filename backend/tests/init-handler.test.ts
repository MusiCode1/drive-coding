/**
 * Integration tests for `handleInitMessage` — the init message handler.
 *
 * Tests use a fake `createBridge` that returns a stub AcpBridge, since
 * the init flow doesn't rely on protocol-level mechanics — it tests
 * orchestration: bridge creation, session selection, model override,
 * history streaming, ready emission.
 *
 * Behaviors documented in `docs/behaviors.md` (WS-6, WS-8, WS-9, WS-10,
 * PROMPT-4, UI-HIST-5).
 */

import { describe, expect, test } from "bun:test";
import type { AcpBridge, PromptOptions } from "../src/acp-bridge.ts";
import { createConnState, type ConnState } from "../src/conn-state.ts";
import {
  handleInitMessage,
  type InitHandlerDeps,
} from "../src/init-handler.ts";
import type { MessageSink, ServerMessage } from "../src/ws-protocol.ts";

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

/** Make a stub bridge that records calls. The test customizes via fields. */
interface StubBridge extends AcpBridge {
  _newSessionResult?: any;
  _loadSessionResult?: any;
  _historyEvents?: Array<
    | { kind: "chunk"; text: string; chunkKind: "message" | "thought" | "user_message" }
    | { kind: "tool_call"; event: "create" | "update"; toolCallId: string; title: string }
  >;
  _setModelImpl?: (modelId: string) => Promise<void>;
}

function makeStubBridge(opts: {
  newSession?: any;
  loadSession?: any;
  historyEvents?: StubBridge["_historyEvents"];
  setModelImpl?: (modelId: string) => Promise<void>;
} = {}): StubBridge {
  let sessionId: string | null = null;
  const bridge: StubBridge = {
    get sessionId() {
      return sessionId;
    },
    getRecentStderr() {
      return [];
    },
    async newSession() {
      const res = opts.newSession ?? { sessionId: "new-sess-id" };
      sessionId = res.sessionId;
      return res;
    },
    async loadSession(id, promptOpts?: PromptOptions) {
      sessionId = id;
      // Replay history events through the callbacks.
      if (opts.historyEvents) {
        for (const ev of opts.historyEvents) {
          if (ev.kind === "chunk") {
            promptOpts?.onChunk?.(ev.text, ev.chunkKind);
          } else {
            promptOpts?.onToolCall?.({
              event: ev.event,
              toolCallId: ev.toolCallId,
              title: ev.title,
            });
          }
        }
      }
      return opts.loadSession ?? { sessionId: id };
    },
    async listSessions() {
      return [];
    },
    async setModel(modelId) {
      if (opts.setModelImpl) {
        await opts.setModelImpl(modelId);
      }
    },
    async prompt() {
      return "";
    },
    async cancel() {
      return;
    },
    async dispose() {
      return;
    },
  };
  return bridge;
}

function defaultDeps(
  bridgeFactory: () => AcpBridge,
  overrides: Partial<InitHandlerDeps> = {},
): InitHandlerDeps {
  return {
    async createBridge(opts) {
      const b = bridgeFactory();
      return b;
    },
    renderMarkdown: (t) => `<p>${t}</p>`,
    printAgentLogs: false,
    ...overrides,
  };
}

describe("handleInitMessage — entry conditions", () => {
  test("already initialized → 'כבר אותחל' error — WS-6", async () => {
    const sink = recordingSink();
    const state: ConnState = createConnState();
    state.bridge = makeStubBridge();
    await handleInitMessage(
      sink,
      state,
      { type: "init", cwd: "/test" },
      defaultDeps(() => makeStubBridge()),
    );
    expect(sink.errors).toContain("כבר אותחל");
  });

  test("voiceId stored in state from msg.voice — WS-8", async () => {
    const sink = recordingSink();
    const state: ConnState = createConnState();
    await handleInitMessage(
      sink,
      state,
      { type: "init", cwd: "/test", voice: "voice-xyz" },
      defaultDeps(() => makeStubBridge()),
    );
    expect(state.voiceId).toBe("voice-xyz");
  });

  test("cwd stored in state from msg.cwd", async () => {
    const sink = recordingSink();
    const state: ConnState = createConnState();
    await handleInitMessage(
      sink,
      state,
      { type: "init", cwd: "/my/project" },
      defaultDeps(() => makeStubBridge()),
    );
    expect(state.cwd).toBe("/my/project");
  });

  test("createBridge receives cwd + printAgentLogs", async () => {
    const sink = recordingSink();
    const state: ConnState = createConnState();
    let receivedOpts: any;
    await handleInitMessage(
      sink,
      state,
      { type: "init", cwd: "/test" },
      {
        async createBridge(opts) {
          receivedOpts = opts;
          return makeStubBridge();
        },
        renderMarkdown: (t) => t,
        printAgentLogs: true,
      },
    );
    expect(receivedOpts).toEqual({ cwd: "/test", printAgentLogs: true });
  });
});

describe("handleInitMessage — newSession flow (no sessionId)", () => {
  test("calls newSession, sends ready with sessionId", async () => {
    const sink = recordingSink();
    const state: ConnState = createConnState();
    const bridge = makeStubBridge({
      newSession: { sessionId: "fresh-sess-1" },
    });
    await handleInitMessage(
      sink,
      state,
      { type: "init", cwd: "/test" },
      defaultDeps(() => bridge),
    );
    expect(state.sessionId).toBe("fresh-sess-1");
    const ready = sink.events.find((e) => e.type === "ready") as any;
    expect(ready).toBeDefined();
    expect(ready.sessionId).toBe("fresh-sess-1");
  });

  test("ready includes availableModels + currentModelId — WS-10", async () => {
    const sink = recordingSink();
    const state: ConnState = createConnState();
    const bridge = makeStubBridge({
      newSession: {
        sessionId: "s1",
        availableModels: [{ modelId: "claude", name: "Claude" }],
        currentModelId: "claude",
      },
    });
    await handleInitMessage(
      sink,
      state,
      { type: "init", cwd: "/test" },
      defaultDeps(() => bridge),
    );
    const ready = sink.events.find((e) => e.type === "ready") as any;
    expect(ready.availableModels).toEqual([{ modelId: "claude", name: "Claude" }]);
    expect(ready.currentModelId).toBe("claude");
  });

  test("firstPromptSent stays false for newSession — system prompt will be injected", async () => {
    const sink = recordingSink();
    const state: ConnState = createConnState();
    await handleInitMessage(
      sink,
      state,
      { type: "init", cwd: "/test" },
      defaultDeps(() => makeStubBridge()),
    );
    expect(state.firstPromptSent).toBe(false);
  });
});

describe("handleInitMessage — loadSession flow (with sessionId)", () => {
  test("calls loadSession, sets firstPromptSent=true — PROMPT-4", async () => {
    const sink = recordingSink();
    const state: ConnState = createConnState();
    const bridge = makeStubBridge({
      loadSession: { sessionId: "old-sess" },
    });
    await handleInitMessage(
      sink,
      state,
      { type: "init", cwd: "/test", sessionId: "old-sess" },
      defaultDeps(() => bridge),
    );
    expect(state.firstPromptSent).toBe(true);
  });

  test("emits history_start, history_chunk events, history_done", async () => {
    const sink = recordingSink();
    const state: ConnState = createConnState();
    const bridge = makeStubBridge({
      loadSession: { sessionId: "s" },
      historyEvents: [
        { kind: "chunk", text: "hello", chunkKind: "user_message" },
        { kind: "chunk", text: "world", chunkKind: "message" },
      ],
    });
    await handleInitMessage(
      sink,
      state,
      { type: "init", cwd: "/test", sessionId: "s" },
      defaultDeps(() => bridge),
    );

    const types = sink.events.map((e) => e.type);
    expect(types[0]).toBe("history_start");
    expect(types).toContain("history_chunk");
    // history_done before ready.
    const hdIdx = types.indexOf("history_done");
    const rIdx = types.indexOf("ready");
    expect(hdIdx).toBeGreaterThan(0);
    expect(rIdx).toBeGreaterThan(hdIdx);
  });

  test("history message segments get rendered to message_rendered with source=history — UI-HIST-5", async () => {
    const sink = recordingSink();
    const state: ConnState = createConnState();
    const bridge = makeStubBridge({
      loadSession: { sessionId: "s" },
      historyEvents: [
        { kind: "chunk", text: "agent says ", chunkKind: "message" },
        { kind: "chunk", text: "hello.", chunkKind: "message" },
        // Transition to user_message → triggers flush of accumulated message.
        { kind: "chunk", text: "user reply", chunkKind: "user_message" },
      ],
    });
    await handleInitMessage(
      sink,
      state,
      { type: "init", cwd: "/test", sessionId: "s" },
      defaultDeps(() => bridge),
    );

    const renders = sink.events.filter((e) => e.type === "message_rendered") as any[];
    expect(renders.length).toBeGreaterThanOrEqual(1);
    expect(renders[0].source).toBe("history");
    expect(renders[0].html).toContain("agent says hello.");
  });

  test("history tool_call create flushes pending message buffer", async () => {
    // Documents current behavior: the tool_call event is sent BEFORE the
    // message_rendered of the prior text (because the flush is triggered
    // inside the onToolCall callback AFTER the tool_call send call).
    // This means the frontend gets the raw history_chunk text first,
    // then the tool_call, then the rendered HTML retroactively replacing
    // the bubble content. Tracked for possible future tightening.
    const sink = recordingSink();
    const state: ConnState = createConnState();
    const bridge = makeStubBridge({
      loadSession: { sessionId: "s" },
      historyEvents: [
        { kind: "chunk", text: "before tool", chunkKind: "message" },
        {
          kind: "tool_call",
          event: "create",
          toolCallId: "t1",
          title: "Doing thing",
        },
      ],
    });
    await handleInitMessage(
      sink,
      state,
      { type: "init", cwd: "/test", sessionId: "s" },
      defaultDeps(() => bridge),
    );

    // Both events fire.
    const types = sink.events.map((e) => e.type);
    expect(types).toContain("message_rendered");
    expect(types).toContain("history_tool_call");
    // Order: tool_call sent first, THEN the buffer flushes (current behavior).
    const renderedIdx = types.indexOf("message_rendered");
    const toolIdx = types.indexOf("history_tool_call");
    expect(toolIdx).toBeLessThan(renderedIdx);
  });
});

describe("handleInitMessage — model override (WS-9)", () => {
  test("model param matching current → no setModel call", async () => {
    const sink = recordingSink();
    const state: ConnState = createConnState();
    let setModelCalled = false;
    const bridge = makeStubBridge({
      newSession: {
        sessionId: "s",
        availableModels: [{ modelId: "claude", name: "Claude" }],
        currentModelId: "claude",
      },
      setModelImpl: async () => {
        setModelCalled = true;
      },
    });
    await handleInitMessage(
      sink,
      state,
      { type: "init", cwd: "/test", model: "claude" },
      defaultDeps(() => bridge),
    );
    expect(setModelCalled).toBe(false);
  });

  test("model param differing → setModel called + currentModelId updated", async () => {
    const sink = recordingSink();
    const state: ConnState = createConnState();
    let setModelArg: string | undefined;
    const bridge = makeStubBridge({
      newSession: { sessionId: "s", currentModelId: "default-model" },
      setModelImpl: async (id) => {
        setModelArg = id;
      },
    });
    await handleInitMessage(
      sink,
      state,
      { type: "init", cwd: "/test", model: "new-model" },
      defaultDeps(() => bridge),
    );
    expect(setModelArg).toBe("new-model");
    const ready = sink.events.find((e) => e.type === "ready") as any;
    expect(ready.currentModelId).toBe("new-model");
  });

  test("setModel failure → sendError + ready still sent", async () => {
    const sink = recordingSink();
    const state: ConnState = createConnState();
    const bridge = makeStubBridge({
      newSession: { sessionId: "s", currentModelId: "default" },
      setModelImpl: async () => {
        throw new Error("not supported");
      },
    });
    await handleInitMessage(
      sink,
      state,
      { type: "init", cwd: "/test", model: "fancy-model" },
      defaultDeps(() => bridge),
    );
    expect(sink.errors[0]).toContain("לא ניתן להגדיר model=fancy-model");
    // Ready is still sent (with the old model).
    const ready = sink.events.find((e) => e.type === "ready") as any;
    expect(ready).toBeDefined();
  });
});
