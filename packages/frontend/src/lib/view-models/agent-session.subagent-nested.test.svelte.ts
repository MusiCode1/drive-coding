/**
 * agent-session.subagent-nested.test.svelte.ts — VM integration (slice subagent-nested).
 * Depth-2 nesting: Task → sub-task (MID) → grandchild tool (CHILD).
 *
 * Gate BACKLOG 26: `ls …/*subagent*nested*.test.* | wc -l` > 0
 */

import type { SessionNotification } from "@agentclientprotocol/sdk"
import type { AcpClient } from "@drive-coding/provider/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Bubble, ToolBubble } from "$lib/types/bubble"

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
      (_transport: unknown, callbacks: { onUpdate: (n: SessionNotification) => void }) => {
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

function toolBubble(b: Bubble | undefined): ToolBubble | undefined {
  return b?.kind === "tool" ? b : undefined
}

describe("AgentSession — subagent-nested depth-2 (slice subagent-nested)", () => {
  beforeEach(() => {
    capturedOnUpdate = null
    uuidCounter = 0
  })

  it("CHILD nests under MID (inside PARENT.subFrames), not top-level; update on CHILD reaches grandchild", async () => {
    const session = new AgentSession()
    await session.attach({ cwd: "/proj", cliKind: "claude" })

    // 1. PARENT (Task) top-level
    emitSessionUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "toolu_PARENT",
      title: "Task",
      kind: "other",
      status: "in_progress",
      rawInput: {},
    })

    // 2. MID nested under PARENT
    emitSessionUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "toolu_MID",
      title: "Sub-task",
      kind: "other",
      status: "in_progress",
      rawInput: {},
      _meta: { claudeCode: { parentToolUseId: "toolu_PARENT" } },
    })

    // 3. CHILD nested under MID — must NOT appear top-level
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

    const midBubble = findToolBubble(session.bubbles, "toolu_MID")
    expect(midBubble).toBeDefined()
    const childInMid = midBubble?.subFrames?.find(
      (sf) => sf.kind === "tool" && sf.toolCall.toolCallId === "toolu_CHILD",
    )
    expect(childInMid).toBeDefined()

    const parentBubble = toolBubble(
      session.bubbles.find((b) => b.kind === "tool" && b.toolCall.toolCallId === "toolu_PARENT"),
    )
    expect(parentBubble?.subFrames?.some((sf) => sf.kind === "tool" && sf.toolCall.toolCallId === "toolu_MID")).toBe(
      true,
    )

    // 4. completed update on CHILD must reach the nested grandchild
    emitSessionUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "toolu_CHILD",
      status: "completed",
      rawOutput: "hello-depth-2",
    })

    const updatedChild = findToolBubble(session.bubbles, "toolu_CHILD")
    expect(updatedChild?.toolCall.status).toBe("completed")
    expect(updatedChild?.toolCall.result).toBe("hello-depth-2")
  })
})
