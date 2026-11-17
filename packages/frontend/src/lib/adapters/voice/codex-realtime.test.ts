/**
 * codex-realtime.test.ts — the extMethod RPC wrapper for Codex voice (mocked fetch).
 *
 * Slice: codex-voice-poc. The failure branches matter most: a voice call that silently "starts"
 * without an SDP answer would leave the user talking to nobody.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { speakCodexVoice, startCodexVoice, stopCodexVoice } from "./codex-realtime"

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }))
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

describe("codex-realtime adapter", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("start sends extMethod _codex/realtime/start and returns the SDP answer", async () => {
    const fetchMock = stubFetch(200, { ok: true, timedOut: false, result: { sdp: "v=0 answer" } })
    await expect(startCodexVoice("agent-1", "sess-1", "v=0 offer", "be brief")).resolves.toBe("v=0 answer")
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toMatch(/\/api\/agents\/agent-1\/rpc$/)
    expect(JSON.parse(String(init?.body))).toMatchObject({
      method: "_drive/ext",
      params: { method: "_codex/realtime/start", params: { sessionId: "sess-1", sdp: "v=0 offer", prompt: "be brief" } },
    })
  })

  it.each([
    ["HTTP error with message", 502, { error: "realtime SDP answer timed out" }, /timed out/],
    ["ok:false", 200, { ok: false, error: "Unknown session" }, /Unknown session/],
    ["wait timed out", 200, { ok: true, timedOut: true }, /timed out/],
    ["no SDP in result", 200, { ok: true, timedOut: false, result: {} }, /no SDP answer/],
    ["non-JSON body", 500, undefined, /HTTP 500/],
  ])("start rejects on %s", async (_name, status, body, message) => {
    if (body === undefined) {
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status, json: async () => { throw new Error("not json") } })))
    } else {
      stubFetch(status, body)
    }
    await expect(startCodexVoice("a", "s", "offer", "p")).rejects.toThrow(message)
  })

  it("stop and speak call their own ext methods", async () => {
    const fetchMock = stubFetch(200, { ok: true, timedOut: false, result: {} })
    await stopCodexVoice("a", "s")
    await speakCodexVoice("a", "s", "hello")
    const methods = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).params.method)
    expect(methods).toEqual(["_codex/realtime/stop", "_codex/realtime/appendSpeech"])
  })
})
