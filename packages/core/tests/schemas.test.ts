import { describe, expect, it } from "vitest"
import { ClientMessage, ServerMessage } from "../src"

describe("ClientMessage", () => {
  it("accepts valid ping", () => {
    const result = ClientMessage({ type: "ping" })
    expect(result).toEqual({ type: "ping" })
  })

  it("rejects invalid type", () => {
    const result = ClientMessage({ type: "foo" })
    expect(result).toHaveProperty("summary")
  })
})

describe("ServerMessage", () => {
  it("accepts pong", () => {
    const result = ServerMessage({
      type: "pong",
      echoOf: "ping",
      serverTime: 1234,
    })
    expect(result).toMatchObject({ type: "pong" })
  })
})
