import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { deleteAgent } from "$lib/adapters/agents-api"
import { hostSessionView } from "./__fixtures__/host-session-view"
import { AgentSession } from "./agent-session.svelte"

vi.mock("$lib/adapters/agents-api", () => ({
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  releaseConnection: vi.fn().mockResolvedValue(undefined),
}))

describe("AgentSession permission via the session host", () => {
  let host: ReturnType<typeof hostSessionView>
  let session: AgentSession
  const params = {
    sessionId: "test-session",
    toolCall: { toolCallId: "tool-1" },
    options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    host = hostSessionView({ turnState: "waiting" })
    await host.view.connect()
    session = new AgentSession({ view: host.view })
    session.agentId = "test-agent"
    session._setStatusForTest("connected")
  })

  afterEach(() => host.view.close())

  async function request(requestId: number) {
    host.send({
      sessionUpdate: "_drive/session_update",
      changes: { pending: { elicitation: null, permission: { requestId, params } } },
    })
    await host.settle()
  }

  function expectReply(requestId: number, result: unknown) {
    expect(host.replies).toContainEqual({ kind: "permission", requestId, result })
  }

  it("presents the request and its params from the host", async () => {
    await request(1)
    expect(session.pendingPermission).toMatchObject({ requestId: 1, params })
  })

  it("sends the user response to the host and clears the dialog", async () => {
    await request(1)
    session.resolvePermission("allow")
    await host.settle()
    expectReply(1, { outcome: { outcome: "selected", optionId: "allow" } })
    expect(session.pendingPermission).toBeNull()
  })

  it("sends cancellation when dismissed", async () => {
    await request(1)
    session.cancelPermission()
    await host.settle()
    expectReply(1, { outcome: { outcome: "cancelled" } })
    expect(session.pendingPermission).toBeNull()
  })

  it("shows the replacement provided by the host", async () => {
    await request(1)
    await request(2)
    expect(session.pendingPermission?.requestId).toBe(2)
    expect(host.replies).toEqual([])
  })

  it.each(["detach", "leaveRunning"] as const)("cancels a pending request on %s", async (leave) => {
    await request(1)
    await session[leave]()
    await host.settle()
    expectReply(1, { outcome: { outcome: "cancelled" } })
    expect(session.pendingPermission).toBeNull()
    if (leave === "leaveRunning") expect(deleteAgent).not.toHaveBeenCalled()
  })

  it("cancels a pending request when stopping the turn", async () => {
    await request(1)
    vi.spyOn(host.view, "cancel").mockResolvedValueOnce(undefined)
    await session.cancelTurn()
    expectReply(1, { outcome: { outcome: "cancelled" } })
    expect(session.pendingPermission).toBeNull()
  })
})
