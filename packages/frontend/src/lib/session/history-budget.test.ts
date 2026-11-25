import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const root = fileURLToPath(new URL("../../", import.meta.url))
const sessionDir = join(root, "lib/session")

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return walk(path)
    return /\.ts$/.test(entry.name) && !/\.test(?:\.svelte)?\.ts$/.test(entry.name) ? [path] : []
  })
}

function inlineBudget(source: string): boolean {
  return /maxBytes\s*[:=]\s*\d/.test(source)
}

describe("history-budget (F2)", () => {
  it("production session code does not embed maxBytes numeric literals", () => {
    const hits: string[] = []
    for (const file of walk(sessionDir)) {
      const text = readFileSync(file, "utf8")
      if (inlineBudget(text)) {
        hits.push(relative(root, file))
      }
    }
    expect(hits).toEqual([])
  })

  it("flags an inline override in an option or in a URL", () => {
    expect(inlineBudget("history.get({tail: true, maxBytes: 123})")).toBe(true)
    expect(inlineBudget("fetch('/history?tail=1&maxBytes=999')")).toBe(true)
    expect(inlineBudget("history.get({tail: true, maxBytes: HISTORY_PAGE_BYTES_DEFAULT})")).toBe(
      false,
    )
  })
})
