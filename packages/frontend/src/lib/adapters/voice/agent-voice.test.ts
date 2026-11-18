/**
 * agent-voice.test.ts — the `_drive/voice/*` RPC wrapper (mocked fetch).
 *
 * Slice: codex-voice-poc. The failure branches matter most: a voice call that silently "starts"
 * without an SDP answer would leave the user talking to nobody.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { listAgentVoices, speakAgentVoice, startAgentVoice, stopAgentVoice } from "./agent-voice"

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }))
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

describe("agent-voice adapter", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("start sends extMethod _codex/realtime/start and returns the SDP answer", async () => {
    const fetchMock = stubFetch(200, { ok: true, timedOut: false, result: { sdp: "v=0 answer" } })
    await expect(startAgentVoice("agent-1", "sess-1", "v=0 offer", "be brief")).resolves.toBe(
      "v=0 answer",
    )
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toMatch(/\/api\/agents\/agent-1\/rpc$/)
    expect(JSON.parse(String(init?.body))).toMatchObject({
      method: "_drive/ext",
      params: {
        method: "_drive/voice/start",
        params: { sessionId: "sess-1", sdp: "v=0 offer", instructions: "be brief" },
      },
    })
  })

  it.each([
    ["HTTP error with message", 502, { error: "realtime SDP answer timed out" }, /timed out/],
    ["ok:false", 200, { ok: false, error: "Unknown session" }, /Unknown session/],
    ["wait timed out", 200, { ok: true, timedOut: true }, /timed out/],
    ["no SDP in result", 200, { ok: true, timedOut: false, result: {} }, /sdp/],
    ["non-JSON body", 500, undefined, /HTTP 500/],
  ])("start rejects on %s", async (_name, status, body, message) => {
    if (body === undefined) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: false,
          status,
          json: async () => {
            throw new Error("not json")
          },
        })),
      )
    } else {
      stubFetch(status, body)
    }
    await expect(startAgentVoice("a", "s", "offer", "p")).rejects.toThrow(message)
  })

  it("stop and speak call their own ext methods", async () => {
    const fetchMock = stubFetch(200, { ok: true, timedOut: false, result: {} })
    await stopAgentVoice("a", "s")
    await speakAgentVoice("a", "s", "hello")
    const methods = fetchMock.mock.calls.map(
      ([, init]) => JSON.parse(String(init?.body)).params.method,
    )
    expect(methods).toEqual(["_drive/voice/stop", "_drive/voice/speak"])
  })

  it("listVoices returns the provider's voices and default", async () => {
    const fetchMock = stubFetch(200, {
      ok: true,
      timedOut: false,
      result: { voices: ["cove", "maple"], default: "cove" },
    })
    await expect(listAgentVoices("a", "s")).resolves.toEqual({
      voices: ["cove", "maple"],
      default: "cove",
    })
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).params.method).toBe(
      "_drive/voice/listVoices",
    )
  })

  it("start sends the chosen voice only when there is one", async () => {
    const fetchMock = stubFetch(200, { ok: true, timedOut: false, result: { sdp: "ans" } })
    await startAgentVoice("a", "s", "offer", "p", "maple")
    await startAgentVoice("a", "s", "offer", "p")
    const sent = fetchMock.mock.calls.map(
      ([, init]) => JSON.parse(String(init?.body)).params.params,
    )
    expect(sent[0]).toMatchObject({ voice: "maple" })
    expect(sent[1]).not.toHaveProperty("voice")
  })
})
