import { beforeEach, describe, expect, it, vi } from "vitest"
import { probeMicPermission } from "./mic-permission"

describe("probeMicPermission", () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns unknown when Permissions API missing", async () => {
    vi.stubGlobal("navigator", {})
    expect(await probeMicPermission()).toBe("unknown")
  })

  it("returns prompt when Permissions API reports prompt", async () => {
    vi.stubGlobal("navigator", {
      permissions: {
        query: vi.fn().mockResolvedValue({ state: "prompt" }),
      },
    })
    expect(await probeMicPermission()).toBe("prompt")
  })

  it("returns denied when Permissions API reports denied", async () => {
    vi.stubGlobal("navigator", {
      permissions: {
        query: vi.fn().mockResolvedValue({ state: "denied" }),
      },
    })
    expect(await probeMicPermission()).toBe("denied")
  })
})
