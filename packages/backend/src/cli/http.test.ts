import { afterEach, describe, expect, it, vi } from "vitest"
import { AGENT_ID_HEADER, DRIVE_CODING_AGENT_ID_ENV } from "../agent-identity.js"
import { DC_TOKEN_ENV, SCOPE_HEADER } from "../agent-scope.js"
import { authedInit } from "./authed-init.js"
import { postJson } from "./http.js"

describe("cli/http authedInit", () => {
  const originalFetch = globalThis.fetch
  const originalToken = process.env[DC_TOKEN_ENV]
  const originalAgentId = process.env[DRIVE_CODING_AGENT_ID_ENV]

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalToken === undefined) delete process.env[DC_TOKEN_ENV]
    else process.env[DC_TOKEN_ENV] = originalToken
    if (originalAgentId === undefined) delete process.env[DRIVE_CODING_AGENT_ID_ENV]
    else process.env[DRIVE_CODING_AGENT_ID_ENV] = originalAgentId
    vi.restoreAllMocks()
  })

  it("DELETE includes scope header when DC_TOKEN is set", async () => {
    process.env[DC_TOKEN_ENV] = "test-scope-token"
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }))
    globalThis.fetch = fetchMock as typeof fetch

    await fetch("http://127.0.0.1:9/api/agents/a", authedInit({ method: "DELETE" }))

    expect(fetchMock).toHaveBeenCalledOnce()
    const deleteCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(new Headers(deleteCall[1].headers).get(SCOPE_HEADER)).toBe("test-scope-token")
  })

  it("postJson includes scope header when DC_TOKEN is set", async () => {
    process.env[DC_TOKEN_ENV] = "post-token"
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }))
    globalThis.fetch = fetchMock as typeof fetch

    await postJson("http://127.0.0.1:9/api/agents/a/rpc", { method: "session/prompt" })

    const postCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(new Headers(postCall[1].headers).get(SCOPE_HEADER)).toBe("post-token")
    expect(new Headers(postCall[1].headers).get("content-type")).toBe("application/json")
  })

  it("authedInit leaves headers unchanged without DC_TOKEN", () => {
    delete process.env[DC_TOKEN_ENV]
    delete process.env[DRIVE_CODING_AGENT_ID_ENV]
    const init = authedInit({ method: "DELETE" })
    expect(init.method).toBe("DELETE")
    expect(init.headers).toBeUndefined()
  })

  it("authedInit adds agent id header and preserves scope header", async () => {
    process.env[DC_TOKEN_ENV] = "scope-only"
    process.env[DRIVE_CODING_AGENT_ID_ENV] = "11111111-1111-4111-8111-111111111111"
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }))
    globalThis.fetch = fetchMock as typeof fetch

    await fetch("http://127.0.0.1:9/api/agents/a/rpc", authedInit({ method: "POST" }))

    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const headers = new Headers(call[1].headers)
    expect(headers.get(SCOPE_HEADER)).toBe("scope-only")
    expect(headers.get(AGENT_ID_HEADER)).toBe("11111111-1111-4111-8111-111111111111")
  })

  it("authedInit adds agent id without scope token", () => {
    delete process.env[DC_TOKEN_ENV]
    process.env[DRIVE_CODING_AGENT_ID_ENV] = "22222222-2222-4222-8222-222222222222"
    const init = authedInit({ method: "GET" })
    expect(new Headers(init.headers).get(AGENT_ID_HEADER)).toBe(
      "22222222-2222-4222-8222-222222222222",
    )
  })
})
