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

  it("base .bubble-row uses 1fr grid, no 28px in default (mobile-first)", () => {
    const baseMatch = styles.match(/\.bubble-row\s*\{([^}]*)\}/)
    expect(baseMatch?.[1]).toBeDefined()
    const base = baseMatch![1]!
    expect(base).toMatch(/grid-template-columns:\s*1fr/)
    expect(base).not.toMatch(/28px/)
    expect(base).toMatch(/width:\s*100%/)
  })

  it("@media (min-width: 768px) includes 28px avatar column", () => {
    expect(styles).toMatch(/@media\s*\(\s*min-width:\s*768px\s*\)/)
    expect(styles).toMatch(/grid-template-columns:\s*28px\s+minmax\(0,\s*1fr\)/)
    expect(styles).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+28px/)
  })

  it("markup uses data-side and Avatar", () => {
    expect(source).toMatch(/data-side=\{side\}/)
    expect(source).toMatch(/<Avatar\s+kind=\{avatar\}/)
  })
})
