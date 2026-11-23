// @vitest-environment jsdom
import { flushSync, mount, unmount } from "svelte"
import { afterEach, describe, expect, it } from "vitest"
import type { ToolBubble as ToolBubbleType } from "$lib/types/bubble"
import ToolBubbleHarness from "./tool-bubble-output-harness.svelte"

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
      result: { formatted_output: "hello codex", exit_code: 0 },
      output: { text: "hello codex", exitCode: 0 },
      ...overrides,
    },
  }
}

describe("ToolBubble — canonical output", () => {
  it("shows canonical text once in the result body with raw details available", () => {
    target = document.createElement("div")
    document.body.appendChild(target)

    app = mount(ToolBubbleHarness, {
      target,
      props: {
        bubble: makeCodexToolBubble(),
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

  it("shows the canonical exit code chip", () => {
    target = document.createElement("div")
    document.body.appendChild(target)

    app = mount(ToolBubbleHarness, {
      target,
      props: {
        bubble: makeCodexToolBubble(),
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
      },
    })
    flushSync()

    const richPres = [
      ...target.querySelectorAll(
        ".section-label + div pre, .section-label + .tool-text-wrapper pre",
      ),
    ]
    const richTexts = richPres.map((el) => el.textContent).filter(Boolean)
    expect(richTexts.filter((t) => t === "rich only")).toHaveLength(1)
    expect(richTexts.filter((t) => t === "hello codex")).toHaveLength(0)
  })
})

it.each([true, undefined] as const)(
  "shows the truncation notice only for a truncated result (%s)",
  (truncated) => {
    target = document.createElement("div")
    document.body.appendChild(target)
    app = mount(ToolBubbleHarness, {
      target,
      props: {
        bubble: makeCodexToolBubble({
          result: undefined,
          output: { text: "tail", exitCode: 3, truncated },
        }),
      },
    })
    flushSync()

    expect(target.querySelector(".tool-text-wrapper pre")?.textContent).toBe("tail")
    expect(target.querySelector(".exit-chip")?.textContent).toContain("3")
    expect(target.querySelector(".output-truncated")?.textContent).toBe(
      truncated ? "chat.tool.output.truncatedHead" : undefined,
    )
    expect(target.querySelector(".raw-output")).toBeNull()
  },
)
