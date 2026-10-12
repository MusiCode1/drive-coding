/**
 * drive-message-source.test.ts — sender resolution and prompt wrapping.
 */

import { parseDriveMessage } from "@drive-coding/core/acp/drive-message-envelope"
import { describe, expect, it } from "vitest"
import {
  senderFromRecord,
  wrapAgentBlocks,
  wrapAgentText,
  wrapPromptContent,
} from "./drive-message-source.js"

const sender = { id: "11111111-1111-4111-8111-111111111111", name: "probe" }

describe("senderFromRecord", () => {
  it("prefers roleLabel over title", () => {
    expect(
      senderFromRecord({
        id: "11111111-1111-4111-8111-111111111111",
        roleLabel: "planner",
        title: "ignored",
      }),
    ).toEqual({ id: "11111111-1111-4111-8111-111111111111", name: "planner" })
  })

  it("uses title when roleLabel empty and skips null title", () => {
    expect(
      senderFromRecord({
        id: "11111111-1111-4111-8111-111111111111",
        title: "session title",
      }),
    ).toEqual({ id: "11111111-1111-4111-8111-111111111111", name: "session title" })
    expect(
      senderFromRecord({ id: "11111111-1111-4111-8111-111111111111", title: null }),
    ).toEqual({ id: "11111111-1111-4111-8111-111111111111" })
  })

  it("returns undefined without id", () => {
    expect(senderFromRecord(null)).toBeUndefined()
    expect(senderFromRecord({ roleLabel: "x" })).toBeUndefined()
  })
})

describe("wrapAgentText", () => {
  it("round-trips plain body with encoding", () => {
    const body = 'a & b <tag> "quote" \'apos\' עברית'
    const wrapped = wrapAgentText(sender, body)
    const parsed = parseDriveMessage(wrapped)
    expect(parsed.isOk()).toBe(true)
    if (parsed.isOk() && parsed.value.source === "agent") {
      expect(parsed.value.sender).toEqual(sender)
      expect(parsed.value.body).toBe(body)
    }
  })

  it("wraps an existing envelope as encoded body under new sender", () => {
    const prior = wrapAgentText(
      { id: "22222222-2222-4222-8222-222222222222", name: "old" },
      "inner",
    )
    const wrapped = wrapAgentText(sender, prior)
    const parsed = parseDriveMessage(wrapped)
    expect(parsed.isOk()).toBe(true)
    if (parsed.isOk() && parsed.value.source === "agent") {
      expect(parsed.value.sender.id).toBe(sender.id)
      expect(parsed.value.body).toBe(prior)
    }
  })
})

describe("wrapAgentBlocks", () => {
  it("single text block gets prefix and suffix", () => {
    const out = wrapAgentBlocks(sender, [{ type: "text", text: "hello" }])
    expect(out).toHaveLength(1)
    const joined = out.map((b) => (b.type === "text" ? b.text : "")).join("")
    const parsed = parseDriveMessage(joined)
    expect(parsed.isOk()).toBe(true)
    if (parsed.isOk() && parsed.value.source === "agent") {
      expect(parsed.value.body).toBe("hello")
    }
  })

  it("preserves image and annotations on non-text blocks", () => {
    const image = {
      type: "image" as const,
      mimeType: "image/png",
      data: "abc123",
      annotations: { priority: 1 },
    }
    const out = wrapAgentBlocks(sender, [
      { type: "text", text: "pre" },
      image,
      { type: "text", text: "post" },
    ])
    expect(out[1]).toEqual(image)
    const joined = out.filter((b) => b.type === "text").map((b) => (b.type === "text" ? b.text : "")).join("")
    const parsed = parseDriveMessage(joined)
    expect(parsed.isOk()).toBe(true)
    if (parsed.isOk() && parsed.value.source === "agent") {
      expect(parsed.value.body).toBe("prepost")
    }
  })

  it("image-only inserts prefix and suffix text blocks", () => {
    const image = { type: "image" as const, mimeType: "image/png", data: "x" }
    const out = wrapAgentBlocks(sender, [image])
    expect(out).toHaveLength(3)
    expect(out[0]?.type).toBe("text")
    expect(out[1]).toEqual(image)
    expect(out[2]?.type).toBe("text")
    const joined = out.filter((b) => b.type === "text").map((b) => (b.type === "text" ? b.text : "")).join("")
    const parsed = parseDriveMessage(joined)
    expect(parsed.isOk()).toBe(true)
    if (parsed.isOk() && parsed.value.source === "agent") {
      expect(parsed.value.body).toBe("")
    }
  })

  it("encodes entities in each text block once", () => {
    const out = wrapAgentBlocks(sender, [{ type: "text", text: "a & b" }])
    const block = out[0]
    expect(block?.type).toBe("text")
    if (block?.type === "text") {
      expect(block.text).toContain("&amp;")
      expect(block.text).not.toContain("a & b")
    }
    const parsed = parseDriveMessage(block?.type === "text" ? block.text : "")
    expect(parsed.isOk()).toBe(true)
  })
})

describe("wrapPromptContent", () => {
  it("passes through when sender missing", () => {
    expect(wrapPromptContent(undefined, "plain")).toBe("plain")
  })
})
