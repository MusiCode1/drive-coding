/**
 * http-live-token.test.ts — integration tests for live token endpoint (no network).
 */

import { Hono } from "hono"
import { describe, expect, it, vi } from "vitest"
import { mintLiveTokenForTest, registerLiveTokenHttp } from "./http-live-token.js"

describe("POST /api/voice/live/token", () => {
  it("returns 503 when GEMINI_API_KEY is missing", async () => {
    const prev = process.env.GEMINI_API_KEY
    delete process.env.GEMINI_API_KEY
    try {
      const app = new Hono()
      registerLiveTokenHttp(app)

      const res = await app.request("/api/voice/live/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ systemInstruction: "test", actions: ["compose_prompt"] }),
      })

      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({ error: "no-api-key" })
    } finally {
      if (prev !== undefined) process.env.GEMINI_API_KEY = prev
    }
  })

  it("returns 400 on invalid body", async () => {
    const app = new Hono()
    registerLiveTokenHttp(app)

    const res = await app.request("/api/voice/live/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actions: ["compose_prompt"] }),
    })

    expect(res.status).toBe(400)
  })

  it("drops unknown action names silently and constraints include non-empty tools", async () => {
    const createSpy = vi.fn().mockResolvedValue({ name: "tokens/test-token" })
    const result = await mintLiveTokenForTest(
      {
        systemInstruction: "sec",
        actions: ["compose_prompt", "not_a_real_action"],
      },
      { GEMINI_API_KEY: "test-key" },
      () => ({ authTokens: { create: createSpy } }),
    )

    expect(result.status).toBe(200)
    expect(createSpy).toHaveBeenCalledOnce()

    const callConfig = createSpy.mock.calls[0]?.[0] as {
      config: {
        liveConnectConstraints: { config: { tools: { functionDeclarations: unknown[] }[] } }
      }
    }
    const tools =
      callConfig.config.liveConnectConstraints.config.tools[0]?.functionDeclarations ?? []
    expect(tools).toHaveLength(1)
    expect((tools[0] as { name: string }).name).toBe("compose_prompt")
  })
})
