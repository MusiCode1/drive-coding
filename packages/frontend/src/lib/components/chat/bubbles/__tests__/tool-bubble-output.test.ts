// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { flushSync, mount, unmount } from "svelte"
import { afterEach, describe, expect, it } from "vitest"
import type { ToolBubble as ToolBubbleType } from "$lib/types/bubble"
import { pinScrollToEnd } from "../pin-truncated-end"
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

function mountBubble(
  output: ToolBubbleType["toolCall"]["output"],
  showTools = true,
): HTMLDivElement {
  target = document.createElement("div")
  document.body.appendChild(target)
  app = mount(ToolBubbleHarness, {
    target,
    props: {
      showTools,
      bubble: makeCodexToolBubble({ result: undefined, output }),
    },
  })
  flushSync()
  const root = target
  if (root === null) throw new Error("mount failed")
  return root
}

function outputPre(root: ParentNode): HTMLElement {
  const pre = root.querySelector(".tool-text-wrapper pre")
  if (!(pre instanceof HTMLElement)) throw new Error("missing output pre")
  return pre
}

function stubScroll(el: HTMLElement, height: number): void {
  let top = 0
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => height })
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = value
    },
  })
}

function openDetails(root: ParentNode): void {
  const details = root.querySelector("details")
  if (!(details instanceof HTMLDetailsElement)) throw new Error("missing details")
  details.open = true
  details.dispatchEvent(new Event("toggle"))
  flushSync()
}

describe("truncated output display", () => {
  it("drops a leading partial line in the bubble and leaves the stored text", () => {
    const output = { text: "248\n249\n250", exitCode: 3, truncated: true as const }
    const root = mountBubble(output)
    expect(outputPre(root).textContent).toBe("249\n250")
    expect(output.text).toBe("248\n249\n250")
  })

  it("shows a truncated tail that has no newline unchanged", () => {
    const output = { text: "248249", exitCode: 3, truncated: true as const }
    const root = mountBubble(output)
    expect(outputPre(root).textContent).toBe("248249")
    expect(output.text).toBe("248249")
  })

  it("scrolls the output box to the end when it opens on a truncated tail", () => {
    const root = mountBubble({ text: "248\n249\n250", truncated: true }, false)
    const pre = outputPre(root)
    stubScroll(pre, 640)
    expect(pre.scrollTop).toBe(0)
    openDetails(root)
    expect(pre.scrollTop).toBe(640)
  })

  it("pins a scroll box to its last line", () => {
    const node = { scrollTop: 0, scrollHeight: 420 } as HTMLElement
    pinScrollToEnd(node)
    expect(node.scrollTop).toBe(420)
  })

  it("shows the truncation notice before the output and without the small dim style", () => {
    const root = mountBubble({ text: "248\n249", truncated: true })
    const notice = root.querySelector(".output-truncated")
    const pre = outputPre(root)
    expect(notice).toBeInstanceOf(HTMLElement)
    if (!(notice instanceof HTMLElement)) return
    expect(notice.getAttribute("role")).toBe("status")
    expect(notice.getAttribute("dir")).toBe("auto")
    expect(notice.className).not.toContain("opacity-70")
    expect(notice.className).not.toContain("text-[11px]")
    expect(notice.compareDocumentPosition(pre) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../ToolBubble.svelte"),
      "utf8",
    )
    const rule = css.match(/\.output-truncated \{[\s\S]*?\n {2}\}/)?.[0] ?? ""
    expect(rule).toContain("font-weight: 600")
    expect(rule).toContain("font-size: 0.8125rem")
    expect(rule).toContain("padding-inline:")
    expect(rule).toContain("margin-block-end:")
    expect(rule).toContain("text-align: start")
    expect(rule).toContain("var(--fg)")
    expect(rule).toContain("var(--bg-elev)")
    expect(rule).toContain("var(--border)")
    expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })
})
