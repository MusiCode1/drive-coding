/**
 * session-host-charter.test.ts — unit tests (slice agent-charter C2).
 */

import { describe, expect, it, vi } from "vitest"
import type { ProviderConnection } from "@drive-coding/provider/connection"
import {
  applyCharterAtConnect,
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
    const out = prependCharterToContent(
      [{ type: "text", text: "user says hi" }],
      "CHARTER",
    )
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

describe("makePromptCharterHook", () => {
  it("prepends charter on the first call only", () => {
    const consumeCharter = vi
      .fn()
      .mockReturnValueOnce("CHARTER_X")
      .mockReturnValue(undefined)
    const hook = makePromptCharterHook({ consumeCharter }, "agent-1")

    expect(hook("turn one")).toBe("CHARTER_X\n\nturn one")
    expect(hook("turn two")).toBe("turn two")
    expect(consumeCharter).toHaveBeenCalledTimes(2)
    expect(consumeCharter).toHaveBeenNthCalledWith(1, "agent-1")
    expect(consumeCharter).toHaveBeenNthCalledWith(2, "agent-1")
  })
})
