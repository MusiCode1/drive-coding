/**
 * bubble-row.test.ts — mapping + CSS contract gates (BubbleRow alignment rail).
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { bubbleAvatarKind, bubbleSide } from "./bubble-row"

const bubblesDir = dirname(fileURLToPath(import.meta.url))
const bubbleRowPath = join(bubblesDir, "BubbleRow.svelte")

function extractStyleBlock(source: string): string {
  const match = source.match(/<style>([\s\S]*?)<\/style>/)
  if (!match?.[1]) throw new Error("BubbleRow.svelte: no <style> block")
  return match[1]
}

describe("bubbleSide mapping", () => {
  it('returns "end" for user, "start" for all other kinds', () => {
    expect(bubbleSide("user")).toBe("end")
    expect(bubbleSide("message")).toBe("start")
    expect(bubbleSide("thought")).toBe("start")
    expect(bubbleSide("tool")).toBe("start")
  })
})

describe("bubbleAvatarKind mapping", () => {
  it('returns "agent" for message', () => {
    expect(bubbleAvatarKind("message")).toBe("agent")
  })

  it("maps user/thought/tool correctly", () => {
    expect(bubbleAvatarKind("user")).toBe("user")
    expect(bubbleAvatarKind("thought")).toBe("thought")
    expect(bubbleAvatarKind("tool")).toBe("tool")
  })
})

describe("BubbleRow.svelte exists", () => {
  it("BubbleRow.svelte is present at required path", () => {
    expect(() => readFileSync(bubbleRowPath, "utf-8")).not.toThrow()
  })
})

describe("BubbleRow — CSS contract", () => {
  const source = readFileSync(bubbleRowPath, "utf-8")
  const styles = extractStyleBlock(source)

  it("outer rail is full-width flex that justifies a cluster (no 1fr grid)", () => {
    const baseMatch = styles.match(/\.bubble-row\s*\{([^}]*)\}/)
    expect(baseMatch?.[1]).toBeDefined()
    const base = baseMatch![1]!
    expect(base).toMatch(/display:\s*flex/)
    expect(base).toMatch(/width:\s*100%/)
    expect(base).toMatch(/justify-content:\s*start/)
    expect(base).not.toMatch(/grid-template-columns/)
    expect(styles).toMatch(/\.bubble-row-cluster\s*\{/)
    expect(styles).toMatch(/width:\s*fit-content/)
  })

  it("desktop cluster uses row / row-reverse with gap — no 1fr spacer column", () => {
    expect(styles).toMatch(/@media\s*\(\s*min-width:\s*768px\s*\)/)
    expect(styles).toMatch(/flex-direction:\s*row/)
    expect(styles).toMatch(/flex-direction:\s*row-reverse/)
    expect(styles).not.toMatch(/grid-template-columns/)
    expect(styles).not.toMatch(/minmax\(0,\s*1fr\)/)
  })

  it("end side cluster + content shrink-wrap (fit-content)", () => {
    expect(styles).toMatch(
      /\[data-side="end"\][^{]*\.bubble-row-cluster\s*\{[^}]*width:\s*fit-content/,
    )
    expect(styles).toMatch(
      /\[data-side="end"\][^{]*\.bubble-row-content\s*\{[^}]*width:\s*fit-content/,
    )
  })

  it("markup uses data-side, cluster, and Avatar", () => {
    expect(source).toMatch(/data-side=\{side\}/)
    expect(source).toMatch(/bubble-row-cluster/)
    expect(source).toMatch(/<Avatar\s+kind=\{avatar\}/)
  })
})
