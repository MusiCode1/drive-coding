import type { ContentBlock } from "@agentclientprotocol/sdk"
import { describe, expect, it } from "vitest"
import { applyPatch } from "./apply-patch"
import { PatchSchema } from "./patch-schema"
import { reduce } from "./reduce"
import { createInitialSessionState, type SessionState } from "./types"
import { snapshotPayload, updateFrame } from "./wire-frames"

const blocks = {
  text: { type: "text", text: "hello" },
  image: { type: "image", mimeType: "image/png", data: "YWJj" },
  audio: { type: "audio", mimeType: "audio/wav", data: "YWJj" },
  resource_link: { type: "resource_link", name: "Example", uri: "file:///example" },
  resource: { type: "resource", resource: { uri: "file:///example", text: "Example" } },
} satisfies { [K in ContentBlock["type"]]: Extract<ContentBlock, { type: K }> }

const initial = () => createInitialSessionState({ sessionId: "session" })
const chunk = (content: unknown, messageId = "m1", sessionUpdate = "agent_message_chunk") => ({
  sessionUpdate,
  messageId,
  content,
})
const visibleMessages = (state: SessionState) =>
  state.messages.map((message) => {
    if (message.role === "tool") return message
    return {
      messageId: message.messageId,
      text: message.segments.map((segment) => segment.text).join(""),
      attachments: message.attachments ?? [],
      placeholders: message.contentPlaceholders ?? [],
    }
  })
const fold = (updates: readonly unknown[]) =>
  updates.reduce<SessionState>((state, update) => reduce(state, update).state, initial())
function requireContentPatch(content: unknown) {
  const result = reduce(initial(), chunk(content))
  expect(result.patches).toHaveLength(1)
  return result
}

describe("ACP message content", () => {
  it.each(Object.values(blocks))("preserves $type in state and on the wire", (block) => {
    const { state, patches } = requireContentPatch(block)
    const patch = patches[0]
    if (!patch) throw new Error("Missing content patch")
    expect(PatchSchema.allows(patch)).toBe(true)
    expect(applyPatch(initial(), patch).messages).toEqual(state.messages)
    expect(state.carried).toEqual([])
    const frame = updateFrame(state, patch)
    if (frame?.event !== "update") throw new Error("Missing live update frame")
    const live = JSON.parse(frame.data).map(
      (entry: { params: { update: unknown } }) => entry.params.update,
    )
    const snapshot = snapshotPayload(state)
    expect(visibleMessages(fold(live))).toEqual(visibleMessages(state))
    expect(visibleMessages(fold(snapshot.updates))).toEqual(visibleMessages(state))
    if (block.type === "text") {
      expect(visibleMessages(state)).toEqual([
        { messageId: "m1", text: "hello", attachments: [], placeholders: [] },
      ])
    } else {
      expect(
        snapshot.updates.filter((update) => update.sessionUpdate === "agent_message_chunk"),
      ).toEqual([
        expect.objectContaining({
          messageId: "m1",
          content: expect.objectContaining({ type: block.type }),
        }),
      ])
      expect(visibleMessages(state)).toEqual([
        expect.objectContaining({ placeholders: [expect.objectContaining({ kind: block.type })] }),
      ])
    }
  })

  it("negative control: an unhandled content type violates the content coverage check", () => {
    expect(() => requireContentPatch({ type: "future-block" })).toThrow()
  })

  it("keeps a user image and repeated placeholders on their original message across snapshot replay", () => {
    const user = (content: unknown, id = "m1") => chunk(content, id, "user_message_chunk")
    const state = fold([
      user(blocks.text),
      user(blocks.image),
      user({ type: "text", text: " again" }),
      user(blocks.resource_link),
      user({ ...blocks.resource_link, name: "Second" }),
      user({ type: "text", text: "next" }, "m2"),
    ])
    expect(visibleMessages(state)).toEqual([
      {
        messageId: "m1",
        text: "hello again",
        attachments: [{ mimeType: "image/png", dataBase64: "YWJj" }],
        placeholders: [
          { kind: "resource_link", label: "Example", uri: "file:///example" },
          { kind: "resource_link", label: "Second", uri: "file:///example" },
        ],
      },
      { messageId: "m2", text: "next", attachments: [], placeholders: [] },
    ])
    expect(visibleMessages(fold(snapshotPayload(state).updates))).toEqual(visibleMessages(state))
  })
})
