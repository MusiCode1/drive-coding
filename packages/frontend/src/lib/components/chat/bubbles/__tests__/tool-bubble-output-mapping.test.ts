// @vitest-environment jsdom
import { flushSync, mount, unmount } from "svelte"
import { afterEach, describe, expect, it } from "vitest"
import type { ToolBubble as ToolBubbleType } from "$lib/types/bubble"
import ToolBubbleHarness from "./tool-bubble-output-mapping-harness.svelte"

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
    createdAt: Date.now(),
    toolCall: {
      toolCallId: "tc1",
      name: "shell",
      status: "completed",
      args: {},
      result: { formatted_output: "hello codex", exit_code: 0 },
      ...overrides,
    },
  }
}

describe("ToolBubble — mapped Codex output", () => {
  it("shows formatted_output once in result body, not in raw details count", () => {
    target = document.createElement("div")
    document.body.appendChild(target)

    app = mount(ToolBubbleHarness, {
      target,
      props: {
        bubble: makeCodexToolBubble(),
        outputMapping: CODEX_MAPPING,
      },
    })
    flushSync()

    const resultPre = target.querySelector(".section-label + .tool-text-wrapper pre")
    expect(resultPre?.textContent).toBe("hello codex")

    const bodyText = resultPre?.closest("div")?.parentElement?.textContent ?? ""
    const rawDetails = target.querySelector(".raw-output")
    expect(rawDetails).toBeTruthy()
    expect(bodyText.match(/hello codex/g)?.length).toBe(1)
  })

  it("shows exit code chip for mapped exit_code", () => {
    target = document.createElement("div")
    document.body.appendChild(target)

    app = mount(ToolBubbleHarness, {
      target,
      props: {
        bubble: makeCodexToolBubble(),
        outputMapping: CODEX_MAPPING,
      },
    })
    flushSync()

    const chip = target.querySelector(".exit-chip")
    expect(chip?.textContent).toContain("chat.tool.output.exitCode")
    expect(chip?.textContent).toContain("0")
  })

  it("rich ACP content shown once; normalized raw hidden", () => {
    target = document.createElement("div")
    document.body.appendChild(target)

    app = mount(ToolBubbleHarness, {
      target,
      props: {
        bubble: makeCodexToolBubble({
          content: [{ type: "text", text: "rich only" }],
        }),
        outputMapping: CODEX_MAPPING,
      },
    })
    flushSync()

    const richPres = [...target.querySelectorAll(".section-label + div pre, .section-label + .tool-text-wrapper pre")]
    const richTexts = richPres.map((el) => el.textContent).filter(Boolean)
    expect(richTexts.filter((t) => t === "rich only")).toHaveLength(1)
    expect(richTexts.filter((t) => t === "hello codex")).toHaveLength(0)
  })
})
