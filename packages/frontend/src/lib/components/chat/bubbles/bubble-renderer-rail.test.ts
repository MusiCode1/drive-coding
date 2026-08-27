/**
 * bubble-renderer-rail.test.ts — Commit 2 integration gates (BubbleRow wrap + root cleanup).
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const bubblesDir = dirname(fileURLToPath(import.meta.url))
const chatDir = join(bubblesDir, "..")
const rendererPath = join(chatDir, "BubbleRenderer.svelte")
const bubbleFiles = ["UserBubble.svelte", "MessageBubble.svelte", "ThoughtBubble.svelte", "ToolBubble.svelte", "SubagentBubble.svelte"] as const

function readBubble(name: string): string {
  return readFileSync(join(bubblesDir, name), "utf-8")
}

function readBubbleMarkup(name: string): string {
  const src = readBubble(name)
  const parts = src.split("</script>")
  return parts.length > 1 ? parts.slice(1).join("</script>") : src
}

describe("BubbleRenderer — alignment rail integration (Commit 2 gates)", () => {
  const renderer = readFileSync(rendererPath, "utf-8")

  it("wraps switch in BubbleRow with bubbleSide/bubbleAvatarKind", () => {
    expect(renderer).toMatch(/<BubbleRow/)
    expect(renderer).toMatch(/bubbleSide\(bubble\.kind\)/)
    expect(renderer).toMatch(/bubbleAvatarKind\(bubble\.kind\)/)
  })

  it("no Avatar in User/Thought/Tool/Subagent bubbles", () => {
    for (const name of ["UserBubble.svelte", "ThoughtBubble.svelte", "ToolBubble.svelte", "SubagentBubble.svelte"] as const) {
      const markup = readBubbleMarkup(name)
      expect(markup).not.toMatch(/<Avatar/)
      expect(readBubble(name)).not.toMatch(/import Avatar/)
    }
  })

  it("MessageBubble has no Avatar; agent avatar comes from BubbleRow", () => {
    expect(readBubbleMarkup("MessageBubble.svelte")).not.toMatch(/<Avatar/)
    expect(renderer).toMatch(/bubbleAvatarKind/)
  })

  it("no self-start/self-end/flex-row-reverse on bubble markup roots", () => {
    for (const name of bubbleFiles) {
      const markup = readBubbleMarkup(name)
      expect(markup).not.toMatch(/self-start/)
      expect(markup).not.toMatch(/self-end/)
      expect(markup).not.toMatch(/flex-row-reverse/)
    }
  })

  it("MessageBubble keeps w-full without max-w-[85%]", () => {
    const src = readBubble("MessageBubble.svelte")
    expect(src).toMatch(/w-full/)
    expect(src).not.toMatch(/max-w-\[85%\]/)
  })

  it("Thought/Subagent max-w-[85%] on inner card, Tool max-w-[78%]", () => {
    expect(readBubble("ThoughtBubble.svelte")).toMatch(/rounded-xl[\s\S]*max-w-\[85%\]/)
    expect(readBubble("SubagentBubble.svelte")).toMatch(/rounded-xl[\s\S]*max-w-\[85%\]/)
    expect(readBubble("ToolBubble.svelte")).toMatch(/rounded-xl[\s\S]*max-w-\[78%\]/)
  })

  it("User max-w-[85%] on flex wrapper with bubble-actions, no Avatar", () => {
    const src = readBubble("UserBubble.svelte")
    expect(src).toMatch(/max-w-\[85%\]/)
    expect(src).toMatch(/bubble-actions/)
    expect(src).not.toMatch(/<Avatar/)
  })
})
