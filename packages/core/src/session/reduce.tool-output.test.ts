import { describe, expect, it } from "vitest"
import { reduce } from "./reduce"
import { TOOL_OUTPUT_META_KEY, type ToolOutputRules, unclassifiedToolMetaKeys } from "./tool-output"
import { createInitialSessionState } from "./types"

const rules: ToolOutputRules = {
  fields: {
    text: [{ from: "meta", key: "stream", path: ["data"] }],
  },
  metaKeys: { stream: "append", stable: "replace", ignored: "ignore" },
}
const initial = createInitialSessionState({ sessionId: "output" })
const options = { toolOutput: rules }
const create = { sessionUpdate: "tool_call", toolCallId: "test" }
const update = { sessionUpdate: "tool_call_update", toolCallId: "test" }

describe("reduce tool output", () => {
  it.each([create, update])(
    "derives output and strips chunks on creation with $sessionUpdate",
    (frame) => {
      const { state, patches } = reduce(
        initial,
        {
          ...frame,
          _meta: { stream: { data: "one" }, stable: true, ignored: false, unknown: 1 },
        },
        options,
      )
      expect(state.messages[0]).toMatchObject({
        toolCall: { output: { text: "one" }, outputRank: { text: 0 } },
        meta: { stable: true, ignored: false, unknown: 1 },
      })
      expect(state.messages[0]?.meta).toEqual({ stable: true, ignored: false, unknown: 1 })
      expect(patches[0]).toMatchObject({ op: "add-message", message: state.messages[0] })
    },
  )

  it("strips an invalid classified chunk but preserves other metadata without emitting an empty delta", () => {
    const { state } = reduce(initial, create, options)
    const result = reduce(
      state,
      { ...update, _meta: { stream: { data: 42 }, stable: true } },
      options,
    )
    expect(result.patches).toEqual([
      { op: "update-tool", version: 2, targetId: "m_0", toolCall: {}, meta: { stable: true } },
    ])
  })

  it("applies a canonical delta in preference to the configured mapping", () => {
    const { state } = reduce(initial, create, options)
    const after = reduce(
      state,
      {
        ...update,
        _meta: {
          stream: { data: "raw" },
          [TOOL_OUTPUT_META_KEY]: { append: { text: "canonical" } },
        },
      },
      options,
    )
    expect(after.state.messages[0]).toMatchObject({ toolCall: { output: { text: "canonical" } } })
    expect(JSON.stringify(after.patches)).not.toContain(TOOL_OUTPUT_META_KEY)
    expect(JSON.stringify(after.state)).not.toContain("outputRank")
  })

  it("removes an invalid canonical delta, without falling back to the mapping", () => {
    const { state, patches } = reduce(
      initial,
      {
        ...create,
        _meta: {
          [TOOL_OUTPUT_META_KEY]: { set: { text: false, unknown: "x" } },
          stream: { data: "raw" },
        },
      },
      options,
    )
    expect(state.messages[0]).not.toHaveProperty("toolCall.output")
    expect(JSON.stringify(patches)).not.toContain(TOOL_OUTPUT_META_KEY)
  })

  it.each(["terminal_update", "terminal_output_chunk"])(
    "continues carrying ACP v2 %s",
    (sessionUpdate) => {
      const frame = { sessionUpdate, terminalId: "test", data: "raw" }
      expect(reduce(initial, frame, options).patches).toEqual([
        { op: "opaque", version: 1, update: frame },
      ])
    },
  )

  it("reports only unclassified provider keys on tool frames", () => {
    const _meta = { stream: 1, stable: 1, ignored: 1, foreign: 1, "_drive/x": 1 }
    expect(unclassifiedToolMetaKeys(rules, { ...update, _meta })).toEqual(["foreign"])
    expect(
      unclassifiedToolMetaKeys(rules, { sessionUpdate: "agent_message_chunk", _meta }),
    ).toEqual([])
    expect(unclassifiedToolMetaKeys(rules, null)).toEqual([])
  })
})
