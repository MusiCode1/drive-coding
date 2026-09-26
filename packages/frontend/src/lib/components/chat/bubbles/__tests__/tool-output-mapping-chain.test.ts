// @vitest-environment jsdom
import { flushSync, mount, unmount } from "svelte"
import { afterEach, describe, expect, it } from "vitest"
import type { Bubble, ToolBubble as ToolBubbleType } from "$lib/types/bubble"
import ActivityGroupHarness from "./activity-group-output-mapping-harness.svelte"
import SubagentHarness from "./subagent-output-mapping-harness.svelte"

const CODEX_MAPPING = {
  text: [["formatted_output"], ["result", "content", 0, "text"]],
  exitCode: [["exit_code"]],
} as const

let target: HTMLDivElement | null = null
let app: object | null = null

afterEach(() => {
  if (app !== null) unmount(app)
  target?.remove()
  target = null
  app = null
})

function makeCodexToolBubble(overrides?: Partial<ToolBubbleType["toolCall"]>): ToolBubbleType {
  return {
    id: "tb-codex",
    kind: "tool",
    messageId: null,
    segments: [],
    createdAt: Date.now(),
    toolCall: {
      toolCallId: "tc1",
      name: "shell",
      status: "completed",
      args: {},
      result: { formatted_output: "nested mapped", exit_code: 0 },
      ...overrides,
    },
  }
}

describe("outputMapping prop chain — nested bubbles", () => {
  it("ActivityGroupBubble passes mapping to nested ToolBubble", () => {
    const toolBubble = makeCodexToolBubble()
    const allBubbles: Bubble[] = [toolBubble]

    target = document.createElement("div")
    document.body.appendChild(target)

    app = mount(ActivityGroupHarness, {
      target,
      props: {
        bubbles: [toolBubble],
        allBubbles,
        outputMapping: CODEX_MAPPING,
      },
    })
    flushSync()

    target.querySelector<HTMLButtonElement>(".activity-group-toggle")?.click()
    flushSync()

    const resultPre = target.querySelector(
      ".activity-group-body .section-label + .tool-text-wrapper pre",
    )
    expect(resultPre?.textContent).toBe("nested mapped")

    const chip = target.querySelector(".activity-group-body .exit-chip")
    expect(chip?.textContent).toContain("0")
  })

  it("SubagentBubble passes mapping to nested ToolBubble in subFrames", () => {
    const nested = makeCodexToolBubble({ toolCallId: "nested-tc" })
    nested.id = "sf-nested"

    const parent: ToolBubbleType = {
      id: "tb-task",
      kind: "tool",
      messageId: null,
      segments: [],
      createdAt: Date.now(),
      toolCall: {
        toolCallId: "task-tc",
        name: "Task",
        status: "completed",
        args: {},
        task: { status: "completed", subagentType: "test-agent" },
      },
      subFrames: [nested],
    }

    target = document.createElement("div")
    document.body.appendChild(target)

    app = mount(SubagentHarness, {
      target,
      props: {
        bubble: parent,
        outputMapping: CODEX_MAPPING,
      },
    })
    flushSync()

    const resultPre = target.querySelector(
      ".transcript-region .section-label + .tool-text-wrapper pre",
    )
    expect(resultPre?.textContent).toBe("nested mapped")

    const chip = target.querySelector(".transcript-region .exit-chip")
    expect(chip?.textContent).toContain("0")
  })
})
