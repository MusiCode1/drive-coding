import { describe, expect, it } from "vitest"
import { toPatches } from "./frame-router"

const route = (update: unknown) => toPatches({ update })

describe("toPatches", () => {
  it.each([
    ["tool_call", "tool-call"],
    ["tool_call_update", "tool-call-update"],
    ["current_mode_update", "mode"],
    ["config_option_update", "config"],
    ["available_commands_update", "commands"],
    ["plan", "plan"],
    ["plan_update", "plan"],
    ["plan_removed", "plan"],
    ["usage_update", "usage"],
    ["session_info_update", "title"],
  ])("routes %s before any text guard", (sessionUpdate, kind) => {
    expect(route({ sessionUpdate }).map((patch) => patch.kind)).toEqual(["observed", kind])
  })

  it("keeps the raw frame and message id without mutation", () => {
    const update = Object.freeze({
      sessionUpdate: "agent_message_chunk",
      messageId: "m",
      content: { type: "text", text: "hi" },
    })
    expect(route(update)).toEqual([
      { kind: "observed", update },
      { kind: "agent-text", update, messageId: "m" },
    ])
  })

  it.each(["image", "audio", "resource_link", "resource"])("routes non-text user %s", (type) => {
    expect(route({ sessionUpdate: "user_message_chunk", content: { type } })[1]).toMatchObject({
      kind: "user-placeholder",
      messageId: null,
    })
  })

  it("routes user text, image and absent content separately", () => {
    expect(
      route({ sessionUpdate: "user_message_chunk", content: { type: "text", text: "" } })[1]?.kind,
    ).toBe("user-text")
    expect(
      route({
        sessionUpdate: "user_message_chunk",
        content: { type: "image", data: "x", mimeType: "image/png" },
      })[1]?.kind,
    ).toBe("user-image")
    expect(route({ sessionUpdate: "user_message_chunk" })[1]?.kind).toBe("user-placeholder")
  })

  it("distinguishes agent text, empty text and non-text", () => {
    expect(
      route({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } })[1]
        ?.kind,
    ).toBe("agent-text")
    expect(
      route({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "" } }),
    ).toHaveLength(1)
    expect(
      route({ sessionUpdate: "agent_message_chunk", content: { type: "image" } })[1]?.kind,
    ).toBe("agent-placeholder")
  })

  it("ignores empty thought and emits text thought", () => {
    expect(
      route({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "" } }),
    ).toHaveLength(1)
    expect(
      route({
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "thinking" },
      })[1]?.kind,
    ).toBe("thought-text")
  })

  it("observes reset without reducing, and retains unknown input for default", () => {
    expect(route({ sessionUpdate: "_drive/reset" })).toHaveLength(1)
    expect(route({ sessionUpdate: "future_event" })[1]?.kind).toBe("default")
    expect(route(null)[1]?.kind).toBe("default")
  })

  it("accepts valid extensions and silently rejects malformed ones", () => {
    expect(
      route({ sessionUpdate: "_drive/ext_notification", method: "x", params: {} })[1]?.kind,
    ).toBe("ext-notification")
    expect(
      route({ sessionUpdate: "_drive/ext_notification", method: "x", params: null }),
    ).toHaveLength(1)
  })
})
