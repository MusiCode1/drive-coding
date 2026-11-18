/**
 * app-shell-ribbon-visible.test.ts — scroll-follow gate (slice dock-inline, Commit 2).
 *
 * ribbonVisible $effect must survive nesting; it triggers jumpToBottom when the dock toggles.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const appShellPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../AppShell.svelte",
)

describe("AppShell — ribbonVisible scroll follow (dock-inline)", () => {
  it("keeps ribbonVisible derived and referenced inside $effect", () => {
    const source = readFileSync(appShellPath, "utf-8")
    const matches = source.match(/ribbonVisible/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(2)
    expect(source).toMatch(/\$effect\(\(\)\s*=>\s*\{\s*\n\s*void ribbonVisible/)
  })
})
