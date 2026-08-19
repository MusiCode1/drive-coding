/**
 * stream-alive.test.ts — TDD for the SSE liveness signal definitions (Commit 1).
 *
 * Testing: tdd (brief §Commit 1)
 */

import { type } from "arktype"
import { describe, expect, it } from "vitest"
import {
  STREAM_ALIVE_EVENT,
  STREAM_ALIVE_INTERVAL_MS,
  STREAM_ALIVE_METHOD,
  StreamAliveNotification,
} from "./stream-alive.js"

describe("stream-alive — constants", () => {
  it("method name is _drive/streamAlive — distinct from the WS $/ping heartbeat", () => {
    expect(STREAM_ALIVE_METHOD).toBe("_drive/streamAlive")
    expect(STREAM_ALIVE_METHOD).not.toBe("heartbeat")
  })

  it("event name is stream-alive", () => {
    expect(STREAM_ALIVE_EVENT).toBe("stream-alive")
  })

  it("interval is 30s — same cadence as the pre-existing SSE keepalive comment", () => {
    expect(STREAM_ALIVE_INTERVAL_MS).toBe(30_000)
  })
})

describe("stream-alive — StreamAliveNotification schema", () => {
  it("validates the real wire frame built from STREAM_ALIVE_METHOD (catches const/schema drift)", () => {
    const frame = { jsonrpc: "2.0", method: STREAM_ALIVE_METHOD, params: {} }
    const result = StreamAliveNotification(frame)
    expect(result instanceof type.errors).toBe(false)
  })

  it("rejects a frame with the wrong method name", () => {
    const frame = { jsonrpc: "2.0", method: "_drive/somethingElse", params: {} }
    const result = StreamAliveNotification(frame)
    expect(result instanceof type.errors).toBe(true)
  })

  it("rejects a frame missing jsonrpc", () => {
    const frame = { method: STREAM_ALIVE_METHOD, params: {} }
    const result = StreamAliveNotification(frame)
    expect(result instanceof type.errors).toBe(true)
  })

  it("rejects a bare {} — the notification envelope is mandatory, not optional", () => {
    const result = StreamAliveNotification({})
    expect(result instanceof type.errors).toBe(true)
  })
})
