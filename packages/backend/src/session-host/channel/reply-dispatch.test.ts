import { describe, expect, it, vi } from "vitest"
import { createInMemoryAgentRegistry } from "../../agents/registry.js"
import { SCOPE_DENIED_BODY, SCOPE_HEADER } from "../../scope-write.js"
import type { AgentSessionRegistry } from "../registry.js"
import { dispatchReply, replyScopeDenied } from "./reply-dispatch.js"

function setup() {
  const getHost = vi.fn<AgentSessionRegistry["getHost"]>().mockReturnValue(undefined)
  const sessionRegistry = { getHost } as unknown as AgentSessionRegistry
  const deps = { registry: createInMemoryAgentRegistry(), sessionRegistry }
  const readBody = vi.fn().mockRejectedValue(new SyntaxError("invalid JSON"))
  return { deps, getHost, readBody }
}

describe("reply dispatch ordering", () => {
  it("denies scope before looking up a missing host or parsing invalid JSON", async () => {
    const { deps, getHost, readBody } = setup()
    const caller = {
      header: (name: string) => (name === SCOPE_HEADER ? "invalid-test-scope" : undefined),
    }
    const result =
      (await replyScopeDenied(deps, "missing", caller)) ??
      (await dispatchReply(deps.sessionRegistry, "missing", readBody, caller))

    expect(result).toEqual({ status: 403, body: SCOPE_DENIED_BODY })
    expect(getHost).not.toHaveBeenCalled()
    expect(readBody).not.toHaveBeenCalled()
  })

  it("returns 404 for a missing host without parsing invalid JSON", async () => {
    const { deps, readBody } = setup()
    const caller = { header: () => undefined }
    const result =
      (await replyScopeDenied(deps, "missing", caller)) ??
      (await dispatchReply(deps.sessionRegistry, "missing", readBody, caller))

    expect(result).toEqual({
      status: 404,
      body: { error: "Agent connection not found" },
    })
    expect(readBody).not.toHaveBeenCalled()
  })
})
