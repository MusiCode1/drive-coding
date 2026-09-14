/**
 * ping.codec.test.ts — the `_drive/ping` envelope on the wire.
 *
 * The guards that matter are the negative ones: this decoder runs on every frame
 * of every connection, and a false positive would answer — or swallow — a real
 * ACP message.
 */

import { describe, expect, it } from "vitest"
import { decodePing, decodePong, encodePing, encodePong, PING_METHOD } from "./ping.js"

describe("_drive/ping", () => {
  it("uses the registered namespace, not the LSP-style `$/`", () => {
    expect(PING_METHOD).toBe("_drive/ping")
    expect(PING_METHOD.startsWith("$/")).toBe(false)
  })

  it("round-trips a ping", () => {
    const line = encodePing(7)
    expect(line.endsWith("\n")).toBe(true)
    expect(decodePing(line)).toEqual({ id: 7 })
  })

  it("round-trips a pong, with and without info", () => {
    expect(decodePong(encodePong(7), 7)).toEqual({ alive: true })
    expect(decodePong(encodePong("a", { agentId: "x", pid: 42 }), "a")).toEqual({
      alive: true,
      info: { agentId: "x", pid: 42 },
    })
  })

  it("emits a valid JSON-RPC 2.0 request", () => {
    const msg = JSON.parse(encodePing("id-1"))
    expect(msg).toEqual({ jsonrpc: "2.0", id: "id-1", method: PING_METHOD, params: {} })
  })

  it("🔴 refuses to answer a notification — a ping with no id", () => {
    // Replying to a notification is a protocol violation; the peer would see an
    // unmatched response.
    const notif = `${JSON.stringify({ jsonrpc: "2.0", method: PING_METHOD, params: {} })}\n`
    expect(decodePing(notif)).toBeNull()
  })

  it("🔴 leaves real ACP frames alone", () => {
    for (const line of [
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "session/prompt", params: {} })}\n`,
      `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "initialize", params: {} })}\n`,
      `${JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: {} })}\n`,
      `${JSON.stringify({ jsonrpc: "2.0", method: "_drive/streamAlive", params: {} })}\n`,
      `${JSON.stringify({ jsonrpc: "2.0", method: "_drive/getQuota", id: 3, params: {} })}\n`,
    ]) {
      expect(decodePing(line)).toBeNull()
    }
  })

  it("does not choke on garbage, partial lines or empty input", () => {
    for (const line of ["", "   ", "not json", '{"jsonrpc":', "null", '"a string"', "[]"]) {
      expect(decodePing(line)).toBeNull()
      expect(decodePong(line, 1)).toBeNull()
    }
  })

  it("does not mistake prompt text that merely mentions the method name", () => {
    // The cheap pre-filter is a substring check — this is the case it must not
    // get wrong once JSON.parse has run.
    const line = `${JSON.stringify({
      jsonrpc: "2.0",
      id: 9,
      method: "session/prompt",
      params: { prompt: [{ type: "text", text: `explain _drive/ping to me` }] },
    })}\n`
    expect(decodePing(line)).toBeNull()
  })

  it("a pong for a different id is not our pong", () => {
    expect(decodePong(encodePong(1), 2)).toBeNull()
  })

  it("a response without alive:true is not a pong", () => {
    const line = `${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } })}\n`
    expect(decodePong(line, 1)).toBeNull()
  })

  it("an error response is not a pong", () => {
    const line = `${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32601, message: "Method not found" },
    })}\n`
    expect(decodePong(line, 1)).toBeNull()
  })
})
