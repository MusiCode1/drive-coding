import { describe, expect, it } from "vitest"
import { Hono } from "hono"
import { createTokenUsageStore } from "../usage/token-usage-store.js"
import { registerTokenUsageHttp } from "./http-token-usage.js"

describe("GET /api/usage/tokens", () => {
  it("returns sessions sorted by lastSeenAt desc", async () => {
    const store = createTokenUsageStore(`/tmp/dc-http-token-${Date.now()}`)
    store.ingestUsageUpdate({
      agentId: "a1",
      acpSessionId: "s1",
      cliKind: "claude",
      cwd: "/p",
      used: 100,
      size: 1000,
    })
    const app = new Hono()
    registerTokenUsageHttp(app, { tokenUsageStore: store })
    const res = await app.request("/api/usage/tokens?cwd=/p")
    expect(res.status).toBe(200)
    const body = (await res.json()) as { sessions: { acpSessionId: string }[] }
    expect(body.sessions[0]?.acpSessionId).toBe("s1")
  })
})
