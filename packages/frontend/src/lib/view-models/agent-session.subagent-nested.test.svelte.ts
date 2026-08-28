/**
 * agent-session.subagent-nested.test.svelte.ts — depth-2 subagent tool nesting (BACKLOG 26).
 * Task within Task: grandchild tool sits in MID.subFrames, not top-level.
 */

import type { SessionNotification } from "@agentclientprotocol/sdk"
import type { AcpClient } from "@drive-coding/provider/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ToolBubble } from "$lib/types/bubble"

let capturedOnUpdate: ((n: SessionNotification) => void) | null = null

function makeMockClient(): AcpClient {
  return {
    conn: {} as AcpClient["conn"],
    capabilities: {} as AcpClient["capabilities"],
    newSession: vi.fn().mockResolvedValue({ sessionId: "session-nested-test" }),
    loadSession: vi.fn().mockResolvedValue({}),
    listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
    prompt: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    setSessionConfigOption: vi.fn(),
    setSessionMode: vi.fn(),
    setSessionModel: vi.fn(),
    extMethod: vi.fn().mockResolvedValue({ ok: true }),
  } as unknown as AcpClient
}

vi.mock("@drive-coding/provider/client", async (importActual) => {
  const actual = await importActual<typeof import("@drive-coding/provider/client")>()
  return {
    ...actual,
    createAcpClient: vi.fn(
      (
        _transport: unknown,
        callbacks: {
          onUpdate: (n: SessionNotification) => void
        },
      ) => {
        capturedOnUpdate = callbacks.onUpdate
        return Promise.resolve(makeMockClient())
      },
    ),
  }
})

vi.mock("$lib/engines/ws-transport", () => ({
  WsAcpTransport: vi.fn(function mockWsTransport() {
    return {
      onClose: vi.fn(),
      waitForOpen: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      closeAndWait: vi.fn().mockResolvedValue(undefined),
    }
  }),
}))

vi.mock("$lib/adapters/agents-api", () => ({
  createAgent: vi.fn().mockResolvedValue({ agentId: "agent-nested-test" }),
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  notifySessionAttached: vi.fn().mockResolvedValue(undefined),
  listAgents: vi.fn().mockResolvedValue([]),
  patchAgent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("$lib/adapters/sessions", () => ({
  normalizeSessionInfo: vi.fn((x: unknown) => x),
}))

vi.mock("$lib/adapters/ext", () => ({
  createExtClient: vi.fn(() => ({
    setThinkingTokens: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.stubGlobal("location", { protocol: "http:", host: "localhost:5173", search: "" })
let uuidCounter = 0
vi.stubGlobal("crypto", { randomUUID: () => `test-uuid-${uuidCounter++}` })

import { AgentSession } from "./agent-session.svelte"
import { findToolBubble } from "./find-tool-bubble"

function emitSessionUpdate(update: Record<string, unknown>): void {
  capturedOnUpdate?.({ update } as SessionNotification)
}

function expectTool(b: unknown): ToolBubble {
  if (typeof b !== "object" || b === null || (b as ToolBubble).kind !== "tool") {
    throw new Error("expected tool bubble")
  }
  return b as ToolBubble
}

describe("AgentSession — subagent nested depth-2 (BACKLOG 26)", () => {
  beforeEach(() => {
    capturedOnUpdate = null
    uuidCounter = 0
  })

  it("CHILD nests in MID.subFrames (not top-level) and completed update reaches grandchild", async () => {
    const session = new AgentSession()
    await session.attach({ cwd: "/proj", cliKind: "claude" })

    emitSessionUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "toolu_PARENT",
      title: "Task",
      kind: "other",
      status: "in_progress",
      rawInput: {},
    })
    emitSessionUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "toolu_MID",
      title: "Nested Task",
      kind: "other",
      status: "pending",
      rawInput: {},
      _meta: { claudeCode: { parentToolUseId: "toolu_PARENT" } },
    })
    emitSessionUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "toolu_CHILD",
      title: "echo nested",
      kind: "execute",
      status: "pending",
      rawInput: {},
      _meta: { claudeCode: { parentToolUseId: "toolu_MID" } },
    })

    const topLevelChild = session.bubbles.find(
      (b) => b.kind === "tool" && b.toolCall.toolCallId === "toolu_CHILD",
    )
    expect(topLevelChild).toBeUndefined()

    const mid = findToolBubble(session.bubbles, "toolu_MID")
    expect(mid).toBeDefined()
    const midBubble = expectTool(mid)
    expect(midBubble.subFrames?.length).toBe(1)
    expect(
      midBubble.subFrames?.[0]?.kind === "tool" && midBubble.subFrames[0].toolCall.toolCallId,
    ).toBe("toolu_CHILD")

    emitSessionUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "toolu_CHILD",
      status: "completed",
      rawOutput: "nested-done",
      _meta: { claudeCode: { parentToolUseId: "toolu_MID" } },
    })

    const childAfter = findToolBubble(session.bubbles, "toolu_CHILD")
    expect(childAfter?.toolCall.status).toBe("completed")
    expect(childAfter?.toolCall.result).toBe("nested-done")
  })
})
