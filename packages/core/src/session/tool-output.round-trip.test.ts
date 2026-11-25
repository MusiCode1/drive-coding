import { expect, it } from "vitest"
import { reduce } from "./reduce"
import { patchToSessionUpdates, SEQ_META_KEY, stateToSessionUpdates } from "./to-session-update"
import { TOOL_OUTPUT_META_KEY, TOOL_OUTPUT_TEXT_CAP, type ToolOutputRules } from "./tool-output"
import { createInitialSessionState, type SessionState } from "./types"

const rules: ToolOutputRules = {
  fields: {
    text: [
      { from: "meta", key: "stream", path: ["data"] },
      { from: "raw", path: ["text"] },
    ],
    stdout: [{ from: "meta", key: "out", path: [] }],
    exitCode: [{ from: "meta", key: "exit", path: ["code"] }],
  },
  metaKeys: { stream: "append", out: "append", exit: "replace" },
}
const initial = createInitialSessionState({ sessionId: "round-trip" })
const outputOf = (state: SessionState) =>
  state.messages.map((message) => (message.role === "tool" ? message.toolCall.output : undefined))

it("keeps two capped fields identical during live updates and when continuing after a snapshot", () => {
  const update = { sessionUpdate: "tool_call_update", toolCallId: "tool" }
  const almostFull = "x".repeat(TOOL_OUTPUT_TEXT_CAP - 1)
  const frames = [
    { sessionUpdate: "tool_call", toolCallId: "tool", rawOutput: { text: "fallback" } },
    { ...update, _meta: { stream: { data: almostFull }, out: almostFull } },
    { ...update, rawOutput: { text: "ignored" } },
    { ...update, _meta: { stream: { data: "one" }, out: "two" } },
    { ...update, status: "in_progress" },
    { ...update, _meta: { stream: { data: " end" }, exit: { code: 3 } }, status: "failed" },
  ]
  let server = initial
  let live = initial
  let resumed = initial
  for (const [i, frame] of frames.entries()) {
    const next = reduce(server, frame, { toolOutput: rules })
    server = next.state
    for (const patch of next.patches) {
      for (const wire of patchToSessionUpdates(server, patch)) {
        expect(wire._meta ?? {}).not.toHaveProperty("stream")
        expect(wire._meta ?? {}).not.toHaveProperty("out")
        expect(JSON.stringify(wire)).not.toContain("outputRank")
        if (i === 3)
          expect(wire._meta).toEqual({
            [TOOL_OUTPUT_META_KEY]: { append: { text: "one", stdout: "two" }, truncated: true },
            [SEQ_META_KEY]: expect.any(Number),
          })
        live = reduce(live, wire).state
        if (i > 3) resumed = reduce(resumed, wire).state
      }
    }
    expect(outputOf(live)).toEqual(outputOf(server))
    const folded = stateToSessionUpdates(server).reduce(
      (state, wire) => reduce(state, wire).state,
      initial,
    )
    expect(outputOf(folded)).toEqual(outputOf(server))
    if (i === 3) resumed = folded
    if (i >= 3) expect(outputOf(resumed)).toEqual(outputOf(server))
  }
  expect(outputOf(server)).toEqual([
    {
      text: `${"x".repeat(TOOL_OUTPUT_TEXT_CAP - 7)}one end`,
      stdout: `${"x".repeat(TOOL_OUTPUT_TEXT_CAP - 3)}two`,
      exitCode: 3,
      truncated: true,
    },
  ])
})
