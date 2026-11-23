import { createInitialSessionState, type ToolOutputRules } from "@drive-coding/core/session"
import { expect, it, vi } from "vitest"
import { createUpdateIngest } from "./session-host-ingest.js"

function setup(toolOutputRules?: ToolOutputRules) {
  const logger = { warn: vi.fn() }
  const state = createInitialSessionState({ sessionId: "s1" })
  const { handleUpdate } = createUpdateIngest({
    isDisposed: () => false,
    getState: () => state,
    emit: vi.fn(),
    toolOutputRules,
    logger,
  })
  return {
    warn: logger.warn,
    update: (_meta: Record<string, unknown>) =>
      handleUpdate({
        sessionId: "s1",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "tool",
          title: "Test",
          status: "pending",
          _meta,
        },
      }),
  }
}

it("warns only once per unclassified provider key in each configured host", () => {
  const rules: ToolOutputRules = {
    fields: {},
    metaKeys: { appendable: "append", stable: "replace", ignored: "ignore" },
  }
  const { warn, update } = setup(rules)
  update({ appendable: 1, stable: 1, ignored: 1, "_drive/x": 1 })
  expect(warn).not.toHaveBeenCalled()
  update({ foreign: true })
  update({ foreign: false })
  expect(warn).toHaveBeenCalledExactlyOnceWith(
    { key: "foreign" },
    "unclassified tool _meta key — add it to metaKeys",
  )
  update({ other: true })
  expect(warn).toHaveBeenCalledTimes(2)
  const second = setup(rules)
  second.update({ foreign: true })
  expect(second.warn).toHaveBeenCalledTimes(1)
})

it("leaves tool metadata warnings silent when there is no mapping", () => {
  const { warn, update } = setup()
  update({ unknown: true })
  expect(warn).not.toHaveBeenCalled()
})
