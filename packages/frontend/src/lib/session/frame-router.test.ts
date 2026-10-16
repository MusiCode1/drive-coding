import { describe, expect, it, vi } from "vitest"
import { classifySessionUpdate } from "./frame-router"

const cases: Array<[unknown, string]> = [
  ...Object.entries({
    tool_call: "tool-call",
    tool_call_update: "tool-update",
    current_mode_update: "mode",
    config_option_update: "config",
    available_commands_update: "commands",
    plan: "plan",
    plan_update: "plan",
    plan_removed: "plan",
    usage_update: "usage",
    session_info_update: "title",
    unknown: "default",
    toString: "default",
  }).map(([sessionUpdate, kind]): [unknown, string] => [{ sessionUpdate }, kind]),
  [{ sessionUpdate: "_drive/ext_notification", method: "x", params: [] }, "extension"],
  ...["text", "image", "resource_link", "audio", "resource", "unknown"].map(
    (type): [unknown, string] => [
      {
        sessionUpdate: "user_message_chunk",
        content: { type, text: "ok", data: 12, mimeType: false },
      },
      (
        {
          text: "user-text",
          image: "user-image",
          resource_link: "user-link",
          audio: "user-audio",
        } as Record<string, string>
      )[type] ?? "user-placeholder",
    ],
  ),
  ...[undefined, null, [], 1, {}].map((content): [unknown, string] => [
    { sessionUpdate: "user_message_chunk", content },
    "user-placeholder",
  ]),
  [
    { sessionUpdate: "user_message_chunk", content: { type: "image", data: "x" } },
    "user-placeholder",
  ],
  [{ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "ok" } }, "agent-text"],
  ...[
    null,
    [],
    1,
    false,
    "x",
    { type: "image" },
    { type: "audio" },
    { type: "resource_link" },
    { type: "resource" },
  ].map((content): [unknown, string] => [
    { sessionUpdate: "agent_message_chunk", content },
    "agent-content",
  ]),
  [{ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "ok" } }, "thought-text"],
  ...[0, 1, false, "str", []].map((update): [unknown, string] => [update, "default"]),
]

describe("classifySessionUpdate", () => {
  it.each(cases)("classifies %# without effects", (update, kind) => {
    if (typeof update === "object" && update !== null) Object.freeze(update)
    const clock = vi.spyOn(Date, "now").mockImplementation(() => {
      throw Error("clock")
    })
    try {
      const first = classifySessionUpdate({ update })
      expect(first.at(-1)?.kind).toBe(kind)
      expect(first).toEqual(classifySessionUpdate({ update }))
      expect(first[0]).toEqual({ kind: "observed", update })
      const action = first.at(-1)
      if (action && "update" in action) expect(action.update).toBe(update)
    } finally {
      clock.mockRestore()
    }
  })
  it.each([null, undefined])("throws for nullish update %s", (update) => {
    expect(() => classifySessionUpdate({ update })).toThrow(TypeError)
  })
  it.each([
    { sessionUpdate: "_drive/reset" },
    { sessionUpdate: "_drive/ext_notification", method: 1, params: {} },
    { sessionUpdate: "_drive/ext_notification", method: "x", params: null },
    ...[undefined, null, [], { type: "text", text: "" }, { type: "text", text: 0 }].map(
      (content) => ({ sessionUpdate: "agent_thought_chunk", content }),
    ),
    ...[undefined, { type: "text", text: "" }, { type: "text", text: false }].map((content) => ({
      sessionUpdate: "agent_message_chunk",
      content,
    })),
  ])("keeps silent branch %#", (update) => {
    expect(classifySessionUpdate({ update })).toEqual([{ kind: "observed", update }])
  })
  it("preserves frozen raw metadata, custom arrays and runtime message IDs", () => {
    const claudeCode = Object.freeze(Object.assign([], { parentToolUseId: "parent" }))
    const update = Object.freeze(
      Object.assign([], { sessionUpdate: "tool_call", _meta: Object.freeze({ claudeCode }) }),
    )
    expect(classifySessionUpdate({ update })[1]).toEqual({
      kind: "tool-call",
      update,
      parentToolUseId: "parent",
    })
    const id = Object.freeze({ unusual: true })
    const content = Object.freeze(Object.assign([], { type: "image", data: 17, mimeType: false }))
    const user = Object.freeze({ sessionUpdate: "user_message_chunk", messageId: id, content })
    expect(classifySessionUpdate({ update: user })[1]).toEqual({
      kind: "user-image",
      update: user,
      messageId: id,
      content,
    })
  })
  it.each([
    {},
    { _meta: null },
    { _meta: [] },
    { _meta: { claudeCode: null } },
    { _meta: { claudeCode: { parentToolUseId: 3 } } },
  ])("does not invent a parent %#", (extra) => {
    const update = { sessionUpdate: "tool_call_update", ...extra }
    expect(classifySessionUpdate({ update })[1]).toEqual({
      kind: "tool-update",
      update,
      parentToolUseId: undefined,
    })
  })
})
