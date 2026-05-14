/**
 * Integration tests for the ACP bridge — using in-memory loopback streams
 * + a mock `AgentSideConnection` instead of spawning opencode acp.
 *
 * The pattern (taken from the SDK's own tests):
 *   - two `TransformStream`s as bidirectional pipes
 *   - the bridge under test sits on one side (ClientSideConnection)
 *   - a mock Agent implementation sits on the other (AgentSideConnection)
 *   - they talk real JSON-RPC over real streams — only there's no process
 *
 * Behaviors documented in `docs/behaviors.md` (ACP-*, PROMPT-*).
 */

import { describe, expect, test } from "bun:test";
import {
  AgentSideConnection,
  ndJsonStream,
  type Agent,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import { buildBridgeFromStream, type AcpBridge } from "../src/acp-bridge.ts";

/**
 * Sets up a bridge + mock agent connected via in-memory loopback streams.
 * Returns the bridge and a `triggerUpdate` function the test can use to
 * inject sessionUpdate notifications from the agent's side.
 */
async function setupLoopback(agent: Agent, cwd = "/test"): Promise<{
  bridge: AcpBridge;
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

  const bridge = await buildBridgeFromStream(
    clientStream,
    cwd,
    () => [],
    async () => {},
  );

  return {
    bridge,
    agentConn,
    cleanup: async () => {
      await bridge.dispose();
    },
  };
}

/** Minimal Agent that supports initialize + newSession + prompt. */
function makeMockAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    async initialize(_) {
      return {
        protocolVersion: 1,
        agentCapabilities: {},
        authMethods: [],
      };
    },
    async newSession(_) {
      return { sessionId: "mock-session" };
    },
    async loadSession(_) {
      return {};
    },
    async authenticate(_) {
      return {};
    },
    async prompt(_) {
      return { stopReason: "end_turn" };
    },
    async cancel(_) {
      return;
    },
    ...overrides,
  };
}

describe("ACP bridge — handshake", () => {
  test("buildBridgeFromStream completes initialize and returns a usable bridge", async () => {
    const agent = makeMockAgent();
    const { bridge, cleanup } = await setupLoopback(agent);
    try {
      // sessionId is null before newSession.
      expect(bridge.sessionId).toBeNull();
    } finally {
      await cleanup();
    }
  });

  test("initialize sends protocolVersion=1 (number, not string) — ACP-2", async () => {
    let receivedVersion: unknown = undefined;
    const agent = makeMockAgent({
      async initialize(params) {
        receivedVersion = params.protocolVersion;
        return {
          protocolVersion: 1,
          agentCapabilities: {},
          authMethods: [],
        };
      },
    });
    const { cleanup } = await setupLoopback(agent);
    try {
      expect(receivedVersion).toBe(1);
      expect(typeof receivedVersion).toBe("number");
    } finally {
      await cleanup();
    }
  });

  test("initialize sends clientInfo = voice-acp", async () => {
    let info: unknown = undefined;
    const agent = makeMockAgent({
      async initialize(params: any) {
        info = params.clientInfo;
        return {
          protocolVersion: 1,
          agentCapabilities: {},
          authMethods: [],
        };
      },
    });
    const { cleanup } = await setupLoopback(agent);
    try {
      expect(info).toEqual({ name: "voice-acp", version: "0.1.0" });
    } finally {
      await cleanup();
    }
  });
});

describe("ACP bridge — sessions", () => {
  test("newSession returns sessionId and updates bridge.sessionId — ACP", async () => {
    const agent = makeMockAgent({
      async newSession(_) {
        return { sessionId: "sess-123" };
      },
    });
    const { bridge, cleanup } = await setupLoopback(agent);
    try {
      const res = await bridge.newSession();
      expect(res.sessionId).toBe("sess-123");
      expect(bridge.sessionId).toBe("sess-123");
    } finally {
      await cleanup();
    }
  });

  test("newSession passes cwd from buildBridgeFromStream argument", async () => {
    let receivedCwd: unknown = undefined;
    const agent = makeMockAgent({
      async newSession(params) {
        receivedCwd = params.cwd;
        return { sessionId: "ok" };
      },
    });
    const { bridge, cleanup } = await setupLoopback(agent, "/my/project");
    try {
      await bridge.newSession();
      expect(receivedCwd).toBe("/my/project");
    } finally {
      await cleanup();
    }
  });

  test("newSession extracts availableModels + currentModelId from response — ACP-15", async () => {
    const agent = makeMockAgent({
      async newSession(_) {
        return {
          sessionId: "x",
          models: {
            availableModels: [
              {
                modelId: "claude-3-5-sonnet",
                name: "Claude 3.5 Sonnet",
                description: "Fast model",
              },
              { modelId: "claude-opus", name: "Claude Opus" },
            ],
            currentModelId: "claude-3-5-sonnet",
          },
        } as any;
      },
    });
    const { bridge, cleanup } = await setupLoopback(agent);
    try {
      const res = await bridge.newSession();
      expect(res.availableModels).toEqual([
        {
          modelId: "claude-3-5-sonnet",
          name: "Claude 3.5 Sonnet",
          description: "Fast model",
        },
        {
          modelId: "claude-opus",
          name: "Claude Opus",
          description: undefined,
        },
      ]);
      expect(res.currentModelId).toBe("claude-3-5-sonnet");
    } finally {
      await cleanup();
    }
  });
});

describe("ACP bridge — prompt", () => {
  test("prompt without a session throws — ACP-10", async () => {
    const agent = makeMockAgent();
    const { bridge, cleanup } = await setupLoopback(agent);
    try {
      await expect(bridge.prompt("hello")).rejects.toThrow(/אין session/);
    } finally {
      await cleanup();
    }
  });

  test("prompt streams agent_message_chunk → onChunk(kind=message) — ACP-7", async () => {
    const agent: Agent = {
      async initialize(_) {
        return {
          protocolVersion: 1,
          agentCapabilities: {},
          authMethods: [],
        };
      },
      async newSession(_) {
        return { sessionId: "s1" };
      },
      async loadSession(_) {
        return {};
      },
      async authenticate(_) {
        return {};
      },
      async cancel(_) {
        return;
      },
      // The agent in the SDK pattern can't push notifications directly;
      // it does so via the AgentSideConnection passed to it. We need the
      // conn reference, so we use a different setup here.
      async prompt(_) {
        return { stopReason: "end_turn" };
      },
    };
    const { bridge, agentConn, cleanup } = await setupLoopback(agent);
    try {
      await bridge.newSession();

      // Capture chunks delivered to the bridge handler.
      const chunks: Array<{ text: string; kind: string }> = [];

      // Replace the prompt with one that sends an update mid-flight.
      // Easier: trigger sessionUpdate from outside the agent's prompt.
      // To do that, we attach a custom prompt() that sends updates via agentConn.
      (agent as any).prompt = async (params: any) => {
        const note: SessionNotification = {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "hello world" },
          },
        };
        await agentConn.sessionUpdate(note);
        return { stopReason: "end_turn" };
      };

      const accumulated = await bridge.prompt("anything", {
        onChunk: (text, kind) => {
          chunks.push({ text, kind });
        },
      });

      expect(chunks).toEqual([{ text: "hello world", kind: "message" }]);
      // bridge.prompt returns accumulated message text.
      expect(accumulated).toBe("hello world");
    } finally {
      await cleanup();
    }
  });

  test("prompt streams agent_thought_chunk → onChunk(kind=thought), NOT accumulated", async () => {
    const agent = makeMockAgent();
    const { bridge, agentConn, cleanup } = await setupLoopback(agent);
    try {
      await bridge.newSession();

      (agent as any).prompt = async (params: any) => {
        await agentConn.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: "thinking..." },
          },
        });
        return { stopReason: "end_turn" };
      };

      const chunks: Array<{ text: string; kind: string }> = [];
      const accumulated = await bridge.prompt("x", {
        onChunk: (text, kind) => chunks.push({ text, kind }),
      });

      expect(chunks).toEqual([{ text: "thinking...", kind: "thought" }]);
      // ACP-7: thoughts are NOT accumulated into the returned text.
      expect(accumulated).toBe("");
    } finally {
      await cleanup();
    }
  });

  test("prompt streams tool_call → onToolCall(create) — ACP-8", async () => {
    const agent = makeMockAgent();
    const { bridge, agentConn, cleanup } = await setupLoopback(agent);
    try {
      await bridge.newSession();

      (agent as any).prompt = async (params: any) => {
        await agentConn.sessionUpdate({
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
      };

      const events: any[] = [];
      await bridge.prompt("x", {
        onToolCall: (ev) => events.push(ev),
      });

      expect(events).toEqual([
        {
          event: "create",
          toolCallId: "tc-1",
          title: "Reading README",
          toolKind: "read",
          status: "pending",
        },
      ]);
    } finally {
      await cleanup();
    }
  });

  test("prompt streams tool_call_update → onToolCall(update), missing title becomes empty string", async () => {
    const agent = makeMockAgent();
    const { bridge, agentConn, cleanup } = await setupLoopback(agent);
    try {
      await bridge.newSession();

      (agent as any).prompt = async (params: any) => {
        await agentConn.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "tc-1",
            status: "completed",
            // no title, no kind
          },
        });
        return { stopReason: "end_turn" };
      };

      const events: any[] = [];
      await bridge.prompt("x", { onToolCall: (ev) => events.push(ev) });

      expect(events).toEqual([
        {
          event: "update",
          toolCallId: "tc-1",
          title: "",
          toolKind: undefined,
          status: "completed",
        },
      ]);
    } finally {
      await cleanup();
    }
  });

  test("accumulatedText collects multiple message chunks in order", async () => {
    const agent = makeMockAgent();
    const { bridge, agentConn, cleanup } = await setupLoopback(agent);
    try {
      await bridge.newSession();

      (agent as any).prompt = async (params: any) => {
        for (const t of ["Hello ", "world", "!"]) {
          await agentConn.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: t },
            },
          });
        }
        return { stopReason: "end_turn" };
      };

      const accumulated = await bridge.prompt("x");
      expect(accumulated).toBe("Hello world!");
    } finally {
      await cleanup();
    }
  });

  test("accumulatedText resets between prompts", async () => {
    const agent = makeMockAgent();
    const { bridge, agentConn, cleanup } = await setupLoopback(agent);
    try {
      await bridge.newSession();

      let texts = ["first"];
      (agent as any).prompt = async (params: any) => {
        for (const t of texts) {
          await agentConn.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: t },
            },
          });
        }
        return { stopReason: "end_turn" };
      };

      const r1 = await bridge.prompt("x");
      expect(r1).toBe("first");

      texts = ["second"];
      const r2 = await bridge.prompt("y");
      // ACP-7: each prompt starts a fresh accumulator (not "firstsecond").
      expect(r2).toBe("second");
    } finally {
      await cleanup();
    }
  });
});

describe("ACP bridge — permissions (YOLO)", () => {
  test("requestPermission picks allow_always first — ACP-6", async () => {
    const agent = makeMockAgent();
    const { bridge, agentConn, cleanup } = await setupLoopback(agent);
    try {
      await bridge.newSession();

      let permissionResult: any = undefined;
      (agent as any).prompt = async (params: any) => {
        permissionResult = await agentConn.requestPermission({
          sessionId: params.sessionId,
          toolCall: { toolCallId: "tc-1", title: "do thing" } as any,
          options: [
            { optionId: "deny", name: "Deny", kind: "reject_once" },
            { optionId: "allow_one", name: "Allow once", kind: "allow_once" },
            {
              optionId: "allow_all",
              name: "Always allow",
              kind: "allow_always",
            },
          ],
        });
        return { stopReason: "end_turn" };
      };

      await bridge.prompt("x");
      expect(permissionResult).toEqual({
        outcome: { outcome: "selected", optionId: "allow_all" },
      });
    } finally {
      await cleanup();
    }
  });

  test("falls back to allow_once if no allow_always", async () => {
    const agent = makeMockAgent();
    const { bridge, agentConn, cleanup } = await setupLoopback(agent);
    try {
      await bridge.newSession();

      let permissionResult: any = undefined;
      (agent as any).prompt = async (params: any) => {
        permissionResult = await agentConn.requestPermission({
          sessionId: params.sessionId,
          toolCall: { toolCallId: "tc-1", title: "do thing" } as any,
          options: [
            { optionId: "deny", name: "Deny", kind: "reject_once" },
            { optionId: "allow_one", name: "Allow once", kind: "allow_once" },
          ],
        });
        return { stopReason: "end_turn" };
      };

      await bridge.prompt("x");
      expect(permissionResult).toEqual({
        outcome: { outcome: "selected", optionId: "allow_one" },
      });
    } finally {
      await cleanup();
    }
  });

  test("falls back to first option if neither allow_always nor allow_once", async () => {
    const agent = makeMockAgent();
    const { bridge, agentConn, cleanup } = await setupLoopback(agent);
    try {
      await bridge.newSession();

      let permissionResult: any = undefined;
      (agent as any).prompt = async (params: any) => {
        permissionResult = await agentConn.requestPermission({
          sessionId: params.sessionId,
          toolCall: { toolCallId: "tc-1", title: "do thing" } as any,
          options: [
            { optionId: "deny", name: "Deny", kind: "reject_once" },
            { optionId: "other", name: "Other", kind: "reject_always" },
          ],
        });
        return { stopReason: "end_turn" };
      };

      await bridge.prompt("x");
      expect(permissionResult).toEqual({
        outcome: { outcome: "selected", optionId: "deny" },
      });
    } finally {
      await cleanup();
    }
  });

  test("returns cancelled outcome when no options provided", async () => {
    const agent = makeMockAgent();
    const { bridge, agentConn, cleanup } = await setupLoopback(agent);
    try {
      await bridge.newSession();

      let permissionResult: any = undefined;
      (agent as any).prompt = async (params: any) => {
        permissionResult = await agentConn.requestPermission({
          sessionId: params.sessionId,
          toolCall: { toolCallId: "tc-1", title: "do thing" } as any,
          options: [],
        });
        return { stopReason: "end_turn" };
      };

      await bridge.prompt("x");
      expect(permissionResult).toEqual({
        outcome: { outcome: "cancelled" },
      });
    } finally {
      await cleanup();
    }
  });
});

describe("ACP bridge — diagnostics", () => {
  test("getRecentStderr returns whatever the IO source returns", async () => {
    const agent = makeMockAgent();
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
    new AgentSideConnection(() => agent, agentStream);

    const stderrLines = ["line 1", "line 2", "line 3"];
    const bridge = await buildBridgeFromStream(
      clientStream,
      "/test",
      () => [...stderrLines],
      async () => {},
    );
    try {
      expect(bridge.getRecentStderr()).toEqual(["line 1", "line 2", "line 3"]);
      // It returns a fresh copy each call (so callers can't mutate the buffer).
      const a = bridge.getRecentStderr();
      const b = bridge.getRecentStderr();
      expect(a).not.toBe(b);
    } finally {
      await bridge.dispose();
    }
  });
});

