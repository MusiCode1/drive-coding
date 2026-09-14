import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { reduce } from "../session/reduce.js"
import { createInitialSessionState } from "../session/types.js"
import {
  enrichStreamUpdateWithMedia,
  enrichUpdateWithMedia,
  extractMediaCandidates,
  lookupMedia,
  mediaFromResourceLink,
  mergeMedia,
  mimeFromExt,
} from "./media-catalog.js"

describe("media-catalog", () => {
  it("mimeFromExt maps known extensions", () => {
    expect(mimeFromExt("/tmp/a.mp3")).toBe("audio/mpeg")
    expect(mimeFromExt("/tmp/a.png")).toBe("image/png")
    expect(mimeFromExt("x.bin")).toBeNull()
  })

  it("extractMediaCandidates finds closed local image links", () => {
    expect(extractMediaCandidates("hello ![clip](/tmp/a.mp3) world", null)).toEqual([
      { href: "/tmp/a.mp3", title: "clip" },
    ])
  })

  it("extractMediaCandidates rejects partial links", () => {
    expect(extractMediaCandidates("partial ![clip](/tmp/a.mp", null)).toEqual([])
  })

  it("extractMediaCandidates rejects remote URLs", () => {
    expect(extractMediaCandidates("https://x/a.mp3", "/c")).toEqual([])
  })

  it("mergeMedia merges by uri (last wins fields)", () => {
    const a = [{ uri: "file:///a", mime: "audio/mpeg", title: "old" }]
    const b = [{ uri: "file:///a", mime: "audio/wav", bytes: 12 }]
    expect(mergeMedia(a, b)).toEqual([{ uri: "file:///a", mime: "audio/wav", title: "old", bytes: 12 }])
  })

  it("lookupMedia miss returns undefined", () => {
    expect(lookupMedia([], "file:///x")).toBeUndefined()
  })

  it("mediaFromResourceLink builds a row", () => {
    expect(
      mediaFromResourceLink({ uri: "file:///a", mimeType: "audio/wav", size: 12 }),
    ).toEqual({ uri: "file:///a", mime: "audio/wav", bytes: 12 })
  })

  it("enrichUpdateWithMedia adds _drive/media from text + stat", () => {
    const update = {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "![c](/tmp/a.mp3)" },
    }
    const enriched = enrichUpdateWithMedia(update, null, () => ({ bytes: 99 }))
    const media = (enriched._meta as Record<string, unknown>)["_drive/media"] as Array<{ mime: string }>
    expect(media[0]?.mime).toBe("audio/mpeg")
  })

  it("enrichUpdateWithMedia preserves other _meta keys", () => {
    const update = {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "![c](/tmp/a.mp3)" },
      _meta: { claudeCode: { toolName: "Bash" } },
    }
    const enriched = enrichUpdateWithMedia(update, null, () => ({ bytes: 1 }))
    const meta = enriched._meta as Record<string, unknown>
    expect(meta.claudeCode).toEqual({ toolName: "Bash" })
    expect(Array.isArray(meta["_drive/media"])).toBe(true)
  })
})

describe("enrichStreamUpdateWithMedia", () => {
  const stat = (uri: string) => (uri.includes(".mp3") ? { bytes: 12 } : null)

  it("held empty + whole chunk yields row and empty held", () => {
    const dir = mkdtempSync(join(tmpdir(), "media-stream-"))
    const mp3 = join(dir, "a.mp3")
    writeFileSync(mp3, "x")
    const update = {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: `![c](${mp3})` },
    }
    const { update: out, held } = enrichStreamUpdateWithMedia(update, "", null, stat)
    expect(held).toBe("")
    const media = (out._meta as Record<string, unknown>)["_drive/media"] as Array<{ uri: string }>
    expect(media[0]?.uri).toBe(`file://${mp3}`)
  })

  it("two chunks without newline after ) — row only on closing chunk", () => {
    const mp3 = "/tmp/preview-audio.mp3"
    const first = enrichStreamUpdateWithMedia(
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "![clip](/tmp/preview-a" },
      },
      "",
      null,
      stat,
    )
    expect(first.held).not.toBe("")
    expect(first.update._meta).toBeUndefined()

    const second = enrichStreamUpdateWithMedia(
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "udio.mp3)" },
      },
      first.held,
      null,
      stat,
    )
    expect(second.held).toBe("")
    const media = (second.update._meta as Record<string, unknown>)["_drive/media"] as Array<{ uri: string }>
    expect(media[0]?.uri).toBe(`file://${mp3}`)
  })

  it("three chunks — row only after the third", () => {
    const mp3 = "/tmp/preview-audio.mp3"
    let held = ""
    const steps = ["![clip", "](/tmp/preview-audio.mp", "3)"]
    let enriched: ReturnType<typeof enrichStreamUpdateWithMedia> | undefined
    for (const text of steps) {
      enriched = enrichStreamUpdateWithMedia(
        { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
        held,
        null,
        stat,
      )
      if (text !== "3)") {
        expect(enriched.update._meta).toBeUndefined()
        expect(enriched.held).not.toBe("")
      }
      held = enriched.held
    }
    expect(enriched?.held).toBe("")
    const media = (enriched?.update._meta as Record<string, unknown>)["_drive/media"] as Array<{ uri: string }>
    expect(media[0]?.uri).toBe(`file://${mp3}`)
  })

  it("content.text stays the chunk delta after enrichment", () => {
    const first = enrichStreamUpdateWithMedia(
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "![clip](/tmp/preview-a" } },
      "",
      null,
      stat,
    )
    const delta = "udio.mp3)"
    const second = enrichStreamUpdateWithMedia(
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: delta } },
      first.held,
      null,
      stat,
    )
    expect((second.update.content as { text: string }).text).toBe(delta)
  })

  it("resource_link does not clear held tail", () => {
    const heldBefore = "![clip](/tmp/preview-a"
    const { held } = enrichStreamUpdateWithMedia(
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "resource_link", uri: "file:///tmp/x.mp3", mimeType: "audio/mpeg" },
      },
      heldBefore,
      null,
      stat,
    )
    expect(held).toBe(heldBefore)
  })
})

describe("meta-passthrough — _drive/media", () => {
  it("chunk _meta _drive/media survives reduce", () => {
    const u = {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "hi" },
      _meta: {
        "_drive/media": [{ uri: "file:///tmp/x.mp3", mime: "audio/mpeg" }],
      },
    }
    const { state, patches } = reduce(createInitialSessionState({ sessionId: "s" }), u)
    expect(state.messages.length).toBeGreaterThan(0)
    const msgMeta = state.messages[state.messages.length - 1]?.meta
    expect(msgMeta?.["_drive/media"]).toEqual(u._meta["_drive/media"])
    const patchMeta = patches.find((p) => p.op === "add-message")?.message?.meta
    expect(patchMeta?.["_drive/media"]).toEqual(u._meta["_drive/media"])
  })
})
