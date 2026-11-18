/**
 * chat-screen-dock-inline.test.ts — nesting gate (slice dock-inline, Commit 1).
 *
 * PlaybackControls must live inside RecordFooter, not as a sibling in ChatScreen footer.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const chatScreenPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../ChatScreen.svelte",
)

describe("ChatScreen — dock-inline nesting", () => {
  it("footer snippet does not render PlaybackControls as sibling of RecordFooter", () => {
    const source = readFileSync(chatScreenPath, "utf-8")
    const footerMatch = source.match(/\{#snippet footer\(\)\}([\s\S]*?)\{\/snippet\}/)
    expect(footerMatch?.[1]).toBeDefined()
    const footerBody = footerMatch![1]!
    expect(footerBody).not.toMatch(/<PlaybackControls\b/)
    expect(footerBody).toMatch(/<RecordFooter\b/)
  })
})
