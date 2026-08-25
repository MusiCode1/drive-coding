// @vitest-environment node
/**
 * markdown-ssr-map.test.ts — gate for the SSR fragment-mapping path.
 *
 * All existing renderMarkdown tests run in jsdom, so the SSR branch (no document)
 * is never exercised. This test verifies ki/ci/ii mapping there.
 */
import { describe, expect, it } from "vitest"
import { BLOCK_SENTINEL, INLINE_SENTINEL } from "./markdown-parse"
import { renderMarkdown } from "./markdown"

const INPUT =
  "start ![a](/tmp/p/x.png) mid $q$ tail\n\n```ts\nconst z = 1\n```\n\n$$w$$ end ![b](/tmp/p/y.png)"

describe("renderMarkdown SSR fragment mapping", () => {
  it("maps image, code, and katex fragments in order without leftover sentinels", () => {
    const out = renderMarkdown(INPUT, { cwd: "/tmp/p" })

    expect(out).toContain(
      `/api/fs/file?uri=${encodeURIComponent("file:///tmp/p/x.png")}`,
    )
    expect(out).toContain(
      `/api/fs/file?uri=${encodeURIComponent("file:///tmp/p/y.png")}`,
    )
    expect(out).toContain("<pre>")
    expect(out).toContain("katex")
    expect(out).not.toContain(BLOCK_SENTINEL)
    expect(out).not.toContain(INLINE_SENTINEL)
  })
})
