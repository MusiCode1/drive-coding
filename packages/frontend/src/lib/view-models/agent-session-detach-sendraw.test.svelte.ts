import { beforeEach, describe, expect, it, vi } from "vitest"
import { deleteAgent } from "$lib/adapters/agents-api"
import { MockSessionView } from "./__fixtures__/mock-session-view.svelte"
import { AgentSession } from "./agent-session.svelte"

vi.mock("$lib/adapters/agents-api", () => ({
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  releaseConnection: vi.fn().mockResolvedValue(undefined),
}))

describe("AgentSession.leaveRunning", () => {
  let session: AgentSession
  let view: MockSessionView

  beforeEach(() => {
    vi.clearAllMocks()
    view = new MockSessionView()
    view.connect("session-to-keep")
    session = new AgentSession({ view })
    session.agentId = "agent-to-keep"
    session._setStatusForTest("connected")
  })

  it("closes the view and resets local status while keeping the backend agent alive", async () => {
    await expect(session.leaveRunning()).resolves.toBeUndefined()
    expect(session.status).toBe("idle")
    expect(view.closeMock).toHaveBeenCalledOnce()
    expect(deleteAgent).not.toHaveBeenCalled()
  })

  it("resets local status even when the view close rejects", async () => {
    view.closeMock.mockRejectedValueOnce(new Error("connection closed"))
    await expect(session.leaveRunning()).resolves.toBeUndefined()
    expect(session.status).toBe("idle")
    expect(deleteAgent).not.toHaveBeenCalled()
  })
})
