/**
 * drive-message-source.api.test.ts — wrapping an api prompt, including block splitting.
 *
 * Block splitting is the part that is easy to get wrong: the shell is spread across the
 * first and last *text* blocks, so the proof is that concatenating the decoded text of
 * all text blocks yields one envelope whose body is the original text in order.
 */

import { parseDriveMessage } from "@drive-coding/core/acp/drive-message-envelope"
import type { PromptBlocks } from "@drive-coding/provider/client"
import { describe, expect, it } from "vitest"
import { wrapPromptContent } from "./drive-message-source.js"

const apiOrigin = { kind: "api", caller: { kind: "tool", name: "ci" } } as const

function joinTextBlocks(blocks: PromptBlocks): string {
  return blocks
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&")
}

describe("wrapPromptContent — api origin", () => {
  it("wraps a string prompt in a source=api envelope with the declared caller", () => {
    const out = wrapPromptContent(apiOrigin, "deploy please")

    expect(typeof out).toBe("string")
    const parsed = parseDriveMessage(out as string)
    expect(parsed.isOk()).toBe(true)
    if (parsed.isOk()) {
      expect(parsed.value).toEqual({
        source: "api",
        caller: { kind: "tool", name: "ci" },
        body: "deploy please",
      })
    }
  })

  it("an api caller that declared nothing still gets an envelope", () => {
    const out = wrapPromptContent({ kind: "api" }, "hello") as string
    const parsed = parseDriveMessage(out)

    expect(parsed.isOk()).toBe(true)
    if (parsed.isOk()) expect(parsed.value).toEqual({ source: "api", body: "hello" })
  })

  it("ui is left untouched — a human typing is the baseline, not an annotation", () => {
    expect(wrapPromptContent({ kind: "ui" }, "plain")).toBe("plain")
  })

  it("undefined is left untouched", () => {
    expect(wrapPromptContent(undefined, "plain")).toBe("plain")
  })

  it("splits the shell across text blocks and leaves an image block in place", () => {
    const blocks: PromptBlocks = [
      { type: "text", text: "before " },
      { type: "image", mimeType: "image/png", data: "AAAA" },
      { type: "text", text: "after" },
    ]

    const out = wrapPromptContent(apiOrigin, blocks) as PromptBlocks

    const image = out.find((b) => b.type === "image")
    expect(image).toEqual({ type: "image", mimeType: "image/png", data: "AAAA" })
    const parsed = parseDriveMessage(joinTextBlocks(out))
    expect(parsed.isOk()).toBe(true)
    if (parsed.isOk()) expect(parsed.value).toMatchObject({ source: "api", body: "before after" })
  })

  it("a prompt with no text block still gets a prefix and suffix block", () => {
    const blocks: PromptBlocks = [{ type: "image", mimeType: "image/png", data: "AAAA" }]

    const out = wrapPromptContent(apiOrigin, blocks) as PromptBlocks

    expect(out).toHaveLength(3)
    expect(out[0]?.type).toBe("text")
    expect(out[2]?.type).toBe("text")
  })
})
