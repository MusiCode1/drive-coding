/**
 * session-scope-policy.test.ts — per-session scope policy VM (scope-policy-per-caller).
 */

import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("../adapters/scope-policy-api.js", () => ({
  fetchScopePolicyForAgent: vi.fn(),
  patchScopePolicyForAgent: vi.fn(),
}))

import {
  fetchScopePolicyForAgent,
  patchScopePolicyForAgent,
} from "../adapters/scope-policy-api.js"
import {
  SCOPE_POLICY_INHERIT,
  SessionScopePolicy,
} from "./session-scope-policy.svelte.js"

const mockFetch = fetchScopePolicyForAgent as ReturnType<typeof vi.fn>
const mockPatch = patchScopePolicyForAgent as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetAllMocks()
})

describe("SessionScopePolicy", () => {
  it("selectValue uses inherit when source is not agent", () => {
    const vm = new SessionScopePolicy(() => "agent-1", () => "")
    vm.confirmed = {
      policies: { message: "allow", update: "ask", close: "ask" },
      sources: { message: "default", update: "default", close: "default" },
    }
    expect(vm.selectValue("message")).toBe(SCOPE_POLICY_INHERIT)
  })

  it("selectValue exposes explicit per-agent policy", () => {
    const vm = new SessionScopePolicy(() => "agent-1", () => "")
    vm.confirmed = {
      policies: { message: "allow", update: "ask", close: "ask" },
      sources: { message: "agent", update: "default", close: "default" },
    }
    expect(vm.selectValue("message")).toBe("allow")
  })

  it("setPolicy with inherit sends null patch", async () => {
    mockPatch.mockResolvedValue({
      policies: { message: "ask", update: "ask", close: "ask" },
      sources: { message: "default", update: "default", close: "default" },
    })
    const vm = new SessionScopePolicy(() => "agent-1", () => "")
    vm.syncAgent("agent-1")
    await vm.setPolicy("message", SCOPE_POLICY_INHERIT)
    expect(mockPatch).toHaveBeenCalledWith({
      agent: "agent-1",
      policies: { message: null },
    })
  })

  it("syncAgent triggers refresh for new agent id", async () => {
    mockFetch.mockResolvedValue({
      policies: { message: "ask", update: "ask", close: "ask" },
      sources: { message: "default", update: "default", close: "default" },
    })
    const vm = new SessionScopePolicy(() => "agent-2", () => "")
    vm.syncAgent("agent-2")
    await Promise.resolve()
    expect(mockFetch).toHaveBeenCalledWith("agent-2")
  })
})
