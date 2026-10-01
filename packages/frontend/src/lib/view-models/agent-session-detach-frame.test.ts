import { describe, expect, it, vi } from "vitest"
import { sendDetachFrame } from "./agent-session-detach-frame"

describe("sendDetachFrame", () => {
  it("sanity: throwing sendRaw propagates when not wrapped", () => {
    const sendRaw = vi.fn(() => {
      throw new Error("transport closed")
    })
    expect(() => sendRaw()).toThrow("transport closed")
  })

  it("swallows sendRaw throw (gate 7b helper)", () => {
    const sendRaw = vi.fn(() => {
      throw new Error("transport closed")
    })
    expect(() => sendDetachFrame({ sendRaw })).not.toThrow()
    expect(sendRaw).toHaveBeenCalledOnce()
  })
})
