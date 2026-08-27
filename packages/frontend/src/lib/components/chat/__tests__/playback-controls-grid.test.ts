/**
 * playback-controls-grid.test.ts — grid width regression gates (dock-inline + §17 mobile overflow).
 *
 * Desktop controls must use repeat(5, auto) + justify-content: center so buttons
 * stay natural size; mobile uses minmax(0, 1fr) with flexible min-width.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const componentPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../PlaybackControls.svelte",
)

function extractStyleBlock(source: string): string {
  const match = source.match(/<style>([\s\S]*?)<\/style>/)
  if (!match?.[1]) throw new Error("PlaybackControls.svelte: no <style> block")
  return match[1]
}

describe("PlaybackControls — controls-grid desktop width (dock-inline)", () => {
  const styles = extractStyleBlock(readFileSync(componentPath, "utf-8"))

  it("base .controls-grid keeps mobile minmax(0,1fr) and 56px touch target", () => {
    const baseMatch = styles.match(/\.controls-grid\s*\{([^}]*)\}/)
    expect(baseMatch?.[1]).toBeDefined()
    const base = baseMatch![1]!
    expect(base).toMatch(/--touch-target-lg:\s*56px/)
    expect(base).toMatch(/grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/)
  })

  it(".controls-grid--desktop uses repeat(5, auto) and centers the row", () => {
    const desktopMatch = styles.match(/\.controls-grid--desktop\s*\{([^}]*)\}/)
    expect(desktopMatch?.[1]).toBeDefined()
    const desktop = desktopMatch![1]!
    expect(desktop).toMatch(/grid-template-columns:\s*repeat\(5,\s*auto\)/)
    expect(desktop).toMatch(/justify-content:\s*center/)
    expect(desktop).not.toMatch(/repeat\(5,\s*1fr\)/)
  })
})

describe("PlaybackControls — mobile overflow fix (§17)", () => {
  const styles = extractStyleBlock(readFileSync(componentPath, "utf-8"))

  it(".ctrl-cell does not enforce min-width floor (flexible cells)", () => {
    const cellMatch = styles.match(/\.ctrl-cell\s*\{([^}]*)\}/)
    expect(cellMatch?.[1]).toBeDefined()
    const cell = cellMatch![1]!
    expect(cell).not.toMatch(/min-width:\s*var\(--touch-target-lg\)/)
    expect(cell).toMatch(/min-width:\s*0/)
  })

  it(".ctrl-cell keeps min-height touch target", () => {
    const cellMatch = styles.match(/\.ctrl-cell\s*\{([^}]*)\}/)
    expect(cellMatch?.[1]).toBeDefined()
    const cell = cellMatch![1]!
    expect(cell).toMatch(/min-height:\s*var\(--touch-target-lg\)/)
  })
})
