import { afterEach, describe, expect, it, vi } from "vitest"
import { DC_TOKEN_ENV, SCOPE_HEADER } from "../agent-scope.js"
import { authedInit } from "./authed-init.js"
import { postJson } from "./http.js"

describe("cli/http authedInit", () => {
  const originalFetch = globalThis.fetch
  const originalToken = process.env[DC_TOKEN_ENV]

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalToken === undefined) delete process.env[DC_TOKEN_ENV]
    else process.env[DC_TOKEN_ENV] = originalToken
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
    const init = authedInit({ method: "DELETE" })
    expect(init.method).toBe("DELETE")
    expect(init.headers).toBeUndefined()
  })
})
