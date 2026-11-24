import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MessageBubble } from "$lib/types/bubble"
import { hostSessionView } from "./__fixtures__/host-session-view"
import { AgentSession } from "./agent-session.svelte"

let host: ReturnType<typeof hostSessionView>

describe("AgentSession agent non-text content", () => {
  let session: AgentSession

  beforeEach(async () => {
    host = hostSessionView()
    await host.view.connect()
    session = new AgentSession({ view: host.view })
  })

  afterEach(() => host.view.close())

  it("agent_message_chunk with image → MessageBubble with contentPlaceholders (not dropped)", async () => {
    host.send({
      sessionUpdate: "agent_message_chunk",
      messageId: "msg-img",
      content: { type: "image", data: "YWJj", mimeType: "image/png" },
    })

    await vi.waitFor(() => expect(session.bubbles).toHaveLength(1))
    const bubble = session.bubbles[0] as MessageBubble
    expect(bubble.kind).toBe("message")
    expect(bubble.contentPlaceholders).toHaveLength(1)
    expect(bubble.contentPlaceholders![0]!.kind).toBe("image")
    expect(bubble.segments).toHaveLength(0)
  })

  it("regression: agent_message_chunk text behaves as before", async () => {
    host.send({
      sessionUpdate: "agent_message_chunk",
      messageId: "msg-txt",
      content: { type: "text", text: "hello agent" },
    })

    await vi.waitFor(() => expect(session.bubbles).toHaveLength(1))
    const bubble = session.bubbles[0] as MessageBubble
    expect(bubble.kind).toBe("message")
    expect(bubble.segments.length).toBeGreaterThan(0)
    expect(bubble.contentPlaceholders).toBeUndefined()
  })
})
