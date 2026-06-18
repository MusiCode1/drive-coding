// @vitest-environment jsdom
/**
 * clipboard.test.ts — TDD עבור copyToClipboard.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { copyToClipboard } from "./clipboard"

describe("copyToClipboard", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("returns true when clipboard.writeText succeeds", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
    const result = await copyToClipboard("hello")
    expect(result).toBe(true)
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("hello")
  })

  it("returns false when clipboard.writeText rejects", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error("denied")),
      },
    })
    const result = await copyToClipboard("hello")
    expect(result).toBe(false)
  })

  it("returns false when navigator.clipboard is undefined", async () => {
    vi.stubGlobal("navigator", {})
    const result = await copyToClipboard("test")
    expect(result).toBe(false)
  })
})
