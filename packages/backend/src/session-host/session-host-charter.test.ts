/**
 * session-host-charter.test.ts — unit tests (slice agent-charter C2).
 */

import {
  parseDriveMessage,
  serializeDriveMessage,
} from "@drive-coding/core/acp/drive-message-envelope"
import type { ProviderConnection } from "@drive-coding/provider/connection"
import { describe, expect, it, vi } from "vitest"
import {
  applyCharterAtConnect,
  applyCharterToContent,
  makePromptCharterHook,
  prependCharterToContent,
} from "./session-host-charter.js"

function mockConn(systemPrompt: "native" | "prepended" | "unsupported"): ProviderConnection {
  const caps = { systemPrompt }
  return {
    capabilities: caps,
  } as ProviderConnection
}

describe("applyCharterAtConnect", () => {
  it("native caps + text → no charter stored, caps stay native", () => {
    const conn = mockConn("native")
    expect(applyCharterAtConnect(conn, "CHARTER")).toEqual({})
    expect(conn.capabilities.systemPrompt).toBe("native")
  })

  it("unsupported caps + text → charter stored, caps become prepended", () => {
    const conn = mockConn("unsupported")
    expect(applyCharterAtConnect(conn, "CHARTER")).toEqual({ charter: "CHARTER" })
    expect(conn.capabilities.systemPrompt).toBe("prepended")
  })

  it("unsupported caps without text → no charter", () => {
    const conn = mockConn("unsupported")
    expect(applyCharterAtConnect(conn, null)).toEqual({})
    expect(conn.capabilities.systemPrompt).toBe("unsupported")
  })
})

describe("prependCharterToContent", () => {
  it("prepends to a string", () => {
    expect(prependCharterToContent("hello", "CHARTER")).toBe("CHARTER\n\nhello")
  })

  it("prepends to the first text block in PromptBlocks", () => {
    const out = prependCharterToContent([{ type: "text", text: "user says hi" }], "CHARTER")
    expect(out).toEqual([{ type: "text", text: "CHARTER\n\nuser says hi" }])
  })

  it("prepends a text block before image-only blocks", () => {
    const imageBlock = {
      type: "image" as const,
      mimeType: "image/png",
      data: "abc",
    }
    const out = prependCharterToContent([imageBlock], "CHARTER")
    expect(out).toEqual([{ type: "text", text: "CHARTER" }, imageBlock])
  })
})

const envelopeAgent = serializeDriveMessage({
  source: "agent",
  sender: { id: "11111111-1111-4111-8111-111111111111", name: "probe" },
  body: "hello from agent",
})

describe("applyCharterToContent", () => {
  const charter = "CHARTER with & and <edge>"

  it("plain string matches legacy prepend (G3 unit)", () => {
    const plain = "user says hi"
    expect(applyCharterToContent(plain, charter)).toBe(prependCharterToContent(plain, charter))
  })

  it("injects context as first child when content is a full envelope", () => {
    const out = applyCharterToContent(envelopeAgent, charter)
    expect(typeof out).toBe("string")
    const parsed = parseDriveMessage(out as string)
    expect(parsed.isOk()).toBe(true)
    if (parsed.isOk() && parsed.value.source === "agent") {
      expect(parsed.value.context).toEqual({ kind: "project-charter", text: charter })
      expect(parsed.value.body).toBe("hello from agent")
    }
  })

  it("falls back to prepend when envelope already has context", () => {
    const withCtx = serializeDriveMessage({
      source: "agent",
      context: { kind: "project-charter", text: "existing" },
      sender: { id: "11111111-1111-4111-8111-111111111111" },
      body: "body",
    })
    expect(applyCharterToContent(withCtx, charter)).toBe(prependCharterToContent(withCtx, charter))
  })

  it("interleaved text blocks: inject in first text block only", () => {
    const { prefix, suffix } = splitEnvelopeForMediaTest(envelopeAgent)
    const image = { type: "image" as const, mimeType: "image/png", data: "abc" }
    const blocks = [
      { type: "text" as const, text: prefix },
      image,
      { type: "text" as const, text: suffix },
    ]
    const out = applyCharterToContent(blocks, charter)
    expect(Array.isArray(out)).toBe(true)
    if (Array.isArray(out)) {
      expect(out[1]).toEqual(image)
      expect(out[2]).toEqual(blocks[2])
      const joined = out
        .filter((b) => b.type === "text")
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("")
      const parsed = parseDriveMessage(joined)
      expect(parsed.isOk()).toBe(true)
      if (parsed.isOk()) {
        expect(parsed.value.context?.text).toBe(charter)
      }
    }
  })

  it("image-only blocks fall back to prepend", () => {
    const image = { type: "image" as const, mimeType: "image/png", data: "abc" }
    expect(applyCharterToContent([image], charter)).toEqual(
      prependCharterToContent([image], charter),
    )
  })

  it("broken envelope falls back to prepend", () => {
    const broken = `${envelopeAgent.slice(0, -10)}`
    expect(applyCharterToContent(broken, charter)).toBe(prependCharterToContent(broken, charter))
  })
})

function splitEnvelopeForMediaTest(xml: string): { prefix: string; suffix: string } {
  const j = xml.indexOf("</body>")
  if (j < 0) throw new Error("no body")
  return { prefix: xml.slice(0, j), suffix: xml.slice(j) }
}

describe("makePromptCharterHook", () => {
  it("prepends charter on the first call only", () => {
    const consumeCharter = vi.fn().mockReturnValueOnce("CHARTER_X").mockReturnValue(undefined)
    const hook = makePromptCharterHook({ consumeCharter }, "agent-1")

    expect(hook("turn one")).toBe("CHARTER_X\n\nturn one")
    expect(hook("turn two")).toBe("turn two")
    expect(consumeCharter).toHaveBeenCalledTimes(2)
    expect(consumeCharter).toHaveBeenNthCalledWith(1, "agent-1")
    expect(consumeCharter).toHaveBeenNthCalledWith(2, "agent-1")
  })
})
