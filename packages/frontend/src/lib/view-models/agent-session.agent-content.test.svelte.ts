/**
 * agent-session.agent-content.test.svelte.ts — non-text agent_message_chunk placeholders.
 */

import type { AcpClient } from "@drive-coding/provider/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { MessageBubble } from "$lib/types/bubble"

let onSessionUpdate: ((notification: unknown) => void) | null = null

vi.mock("@drive-coding/provider/client", async (importActual) => {
  const actual = await importActual<typeof import("@drive-coding/provider/client")>()
  return {
    ...actual,
    createAcpClient: vi.fn(function mockCreateClient(
      _transport: unknown,
      callbackOrCallbacks:
        | ((notification: unknown) => void)
        | { onUpdate: (n: unknown) => void; onExtNotification?: unknown },
    ): Promise<AcpClient> {
      onSessionUpdate =
        typeof callbackOrCallbacks === "function"
          ? callbackOrCallbacks
          : callbackOrCallbacks.onUpdate
      return Promise.resolve({
        newSession: vi.fn().mockResolvedValue({ sessionId: "test-session" }),
        prompt: vi.fn().mockResolvedValue(undefined),
        loadSession: vi.fn().mockResolvedValue({}),
        cancel: vi.fn(),
        listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
        close: vi.fn(),
        setSessionConfigOption: vi.fn(),
        setSessionModel: vi.fn(),
        setSessionMode: vi.fn(),
      } as unknown as AcpClient)
    }),
  }
})

vi.mock("@drive-coding/acp-wire/browser", () => ({
  WsAcpTransport: vi.fn(function mockWsTransport() {
    return {
      onClose: vi.fn(),
      waitForOpen: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }
  }),
}))

vi.mock("$lib/adapters/agents-api", () => ({
  createAgent: vi.fn().mockResolvedValue({ agentId: "test-agent" }),
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  notifySessionAttached: vi.fn().mockResolvedValue(undefined),
}))

import { AgentSession } from "./agent-session.svelte"

function agentImageChunk(messageId: string | null): unknown {
  return {
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "image", data: "abc123", mimeType: "image/png" },
      messageId,
    },
  }
}

function agentTextChunk(text: string, messageId: string | null): unknown {
  return {
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text },
      messageId,
    },
  }
}

describe("AgentSession agent non-text content", () => {
  let session: AgentSession

  beforeEach(async () => {
    vi.clearAllMocks()
    onSessionUpdate = null
    vi.stubGlobal("location", { protocol: "http:", host: "localhost:4000" })
    session = new AgentSession()
    await session.attach({ cwd: "/tmp", cliKind: "claude" })
    expect(onSessionUpdate).not.toBeNull()
  })

  it("agent_message_chunk with image → MessageBubble with contentPlaceholders (not dropped)", () => {
    onSessionUpdate!(agentImageChunk("msg-img"))

    expect(session.bubbles).toHaveLength(1)
    const bubble = session.bubbles[0] as MessageBubble
    expect(bubble.kind).toBe("message")
    expect(bubble.contentPlaceholders).toHaveLength(1)
    expect(bubble.contentPlaceholders![0]!.kind).toBe("image")
    expect(bubble.segments).toHaveLength(0)
  })

  it("regression: agent_message_chunk text behaves as before", () => {
    onSessionUpdate!(agentTextChunk("hello agent", "msg-txt"))

    expect(session.bubbles).toHaveLength(1)
    const bubble = session.bubbles[0] as MessageBubble
    expect(bubble.kind).toBe("message")
    expect(bubble.segments.length).toBeGreaterThan(0)
    expect(bubble.contentPlaceholders).toBeUndefined()
  })
})
