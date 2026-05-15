/**
 * Tests for the message router and parser — pure logic separated from
 * the Bun.serve transport.
 *
 * Behaviors documented in `docs/behaviors.md` (WS-1, WS-1b, WS-3, WS-5,
 * PROMPT-20).
 */

import { describe, expect, test } from "bun:test";
import {
  cancelActivePrompt,
  disposeConnection,
  parseClientMessage,
  routeClientMessage,
  type MessageHandlers,
} from "../src/message-router.ts";
import { createConnState, type ConnState } from "../src/conn-state.ts";
import type { ClientMessage, MessageSink } from "../src/ws-protocol.ts";

// ── recording sink ───────────────────────────────────────────────────────────

function recordingSink() {
  const events: any[] = [];
  const errors: string[] = [];
  const sink: MessageSink = {
    send(msg) {
      events.push(msg);
    },
    sendError(message) {
      errors.push(message);
      events.push({ type: "error", message });
    },
  };
  return Object.assign(sink, { events, errors });
}

// ── parseClientMessage ───────────────────────────────────────────────────────

describe("parseClientMessage — JSON parsing (WS-3)", () => {
  test("valid JSON string → ok", () => {
    const r = parseClientMessage(`{"type":"init","cwd":"/x"}`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.msg.type).toBe("init");
  });

  test("valid JSON Buffer → ok", () => {
    const buf = Buffer.from(`{"type":"cancel"}`, "utf8");
    const r = parseClientMessage(buf);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.msg.type).toBe("cancel");
  });

  test("invalid JSON string → 'JSON לא תקין'", () => {
    const r = parseClientMessage("{not valid json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("JSON לא תקין");
  });

  test("empty string → invalid", () => {
    const r = parseClientMessage("");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("JSON לא תקין");
  });

  test("just whitespace → invalid", () => {
    const r = parseClientMessage("   ");
    expect(r.ok).toBe(false);
  });

  test("number / array are technically valid JSON (just not ClientMessage)", () => {
    // The parser doesn't validate shape — only that JSON parses.
    // (Schema validation is downstream.)
    const r = parseClientMessage("42");
    expect(r.ok).toBe(true);
  });

  test("complex nested message preserved", () => {
    const r = parseClientMessage(
      `{"type":"init","cwd":"/x","sessionId":"abc","model":"m1","voice":"v1"}`,
    );
    expect(r.ok).toBe(true);
    if (r.ok && r.msg.type === "init") {
      expect(r.msg.cwd).toBe("/x");
      expect(r.msg.sessionId).toBe("abc");
      expect(r.msg.model).toBe("m1");
      expect(r.msg.voice).toBe("v1");
    }
  });

  test("Hebrew text in JSON preserved", () => {
    const r = parseClientMessage(`{"type":"text","text":"שלום עולם"}`);
    expect(r.ok).toBe(true);
    if (r.ok && r.msg.type === "text") {
      expect(r.msg.text).toBe("שלום עולם");
    }
  });
});

// ── routeClientMessage ───────────────────────────────────────────────────────

function makeHandlers(overrides: Partial<MessageHandlers> = {}): MessageHandlers & {
  callLog: string[];
} {
  const callLog: string[] = [];
  return Object.assign(
    {
      async onInit(_sink, _state, msg) {
        callLog.push(`init:${msg.cwd}`);
      },
      async onAudio(_sink, _state, msg) {
        callLog.push(`audio:${msg.data.length}`);
      },
      async onText(_sink, _state, text) {
        callLog.push(`text:${text}`);
      },
      async onCancel(_state) {
        callLog.push("cancel");
      },
      ...overrides,
    } as MessageHandlers,
    { callLog },
  );
}

describe("routeClientMessage — dispatch by type (WS-1)", () => {
  test("init → onInit called with msg", async () => {
    const sink = recordingSink();
    const state = createConnState();
    const handlers = makeHandlers();
    await routeClientMessage(
      sink,
      state,
      { type: "init", cwd: "/test" },
      handlers,
    );
    expect(handlers.callLog).toEqual(["init:/test"]);
  });

  test("audio → onAudio called", async () => {
    const sink = recordingSink();
    const state = createConnState();
    const handlers = makeHandlers();
    await routeClientMessage(
      sink,
      state,
      { type: "audio", data: "AAAA" },
      handlers,
    );
    expect(handlers.callLog).toEqual(["audio:4"]);
  });

  test("text → onText called with msg.text (WS-1b)", async () => {
    const sink = recordingSink();
    const state = createConnState();
    const handlers = makeHandlers();
    await routeClientMessage(
      sink,
      state,
      { type: "text", text: "hello" },
      handlers,
    );
    expect(handlers.callLog).toEqual(["text:hello"]);
  });

  test("cancel → onCancel called (PROMPT-20)", async () => {
    const sink = recordingSink();
    const state = createConnState();
    const handlers = makeHandlers();
    await routeClientMessage(sink, state, { type: "cancel" }, handlers);
    expect(handlers.callLog).toEqual(["cancel"]);
  });

  test("unknown type → sendError, no handler called", async () => {
    const sink = recordingSink();
    const state = createConnState();
    const handlers = makeHandlers();
    await routeClientMessage(
      sink,
      state,
      { type: "blah" } as unknown as ClientMessage,
      handlers,
    );
    expect(handlers.callLog).toEqual([]);
    expect(sink.errors[0]).toContain("סוג הודעה לא ידוע");
    expect(sink.errors[0]).toContain("blah");
  });

  test("handler error propagates (caller wraps)", async () => {
    const sink = recordingSink();
    const state = createConnState();
    const handlers = makeHandlers({
      async onInit() {
        throw new Error("boom");
      },
    });
    await expect(
      routeClientMessage(
        sink,
        state,
        { type: "init", cwd: "/x" },
        handlers,
      ),
    ).rejects.toThrow(/boom/);
  });

  test("state is passed through to handlers", async () => {
    const sink = recordingSink();
    const state = createConnState();
    state.lastUserText = "previous";
    let receivedState: ConnState | undefined;
    const handlers = makeHandlers({
      async onText(_sink, s) {
        receivedState = s;
      },
    });
    await routeClientMessage(
      sink,
      state,
      { type: "text", text: "x" },
      handlers,
    );
    expect(receivedState).toBe(state);
    expect(receivedState?.lastUserText).toBe("previous");
  });

  test("sink is passed through to handlers", async () => {
    const sink = recordingSink();
    const state = createConnState();
    let receivedSink: MessageSink | undefined;
    const handlers = makeHandlers({
      async onAudio(s) {
        receivedSink = s;
        s.send({ type: "transcript", text: "from handler" });
      },
    });
    await routeClientMessage(
      sink,
      state,
      { type: "audio", data: "x" },
      handlers,
    );
    expect(receivedSink).toBe(sink);
    expect(sink.events[0]).toMatchObject({
      type: "transcript",
      text: "from handler",
    });
  });
});

// ── disposeConnection (WS-5) ─────────────────────────────────────────────────

describe("disposeConnection — close-time cleanup (WS-5)", () => {
  test("no bridge → noop", async () => {
    const state = createConnState();
    await expect(disposeConnection(state)).resolves.toBeUndefined();
  });

  test("bridge present → dispose called", async () => {
    let disposed = false;
    const state = createConnState();
    state.bridge = {
      async dispose() {
        disposed = true;
      },
    } as any;
    await disposeConnection(state);
    expect(disposed).toBe(true);
  });

  test("dispose throws → silently swallowed (close mustn't crash server)", async () => {
    const state = createConnState();
    state.bridge = {
      async dispose() {
        throw new Error("dispose hung");
      },
    } as any;
    await expect(disposeConnection(state)).resolves.toBeUndefined();
  });
});

// ── cancelActivePrompt (PROMPT-20) ───────────────────────────────────────────

describe("cancelActivePrompt — cancel handler (PROMPT-20)", () => {
  test("no bridge → noop, no throw", async () => {
    const state = createConnState();
    await expect(cancelActivePrompt(state)).resolves.toBeUndefined();
  });

  test("bridge present → cancel called", async () => {
    let cancelled = false;
    const state = createConnState();
    state.bridge = {
      async cancel() {
        cancelled = true;
      },
    } as any;
    await cancelActivePrompt(state);
    expect(cancelled).toBe(true);
  });

  test("cancel throws → silently swallowed", async () => {
    const state = createConnState();
    state.bridge = {
      async cancel() {
        throw new Error("cancel failed");
      },
    } as any;
    await expect(cancelActivePrompt(state)).resolves.toBeUndefined();
  });
});
