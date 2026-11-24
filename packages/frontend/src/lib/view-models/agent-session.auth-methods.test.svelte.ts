import { expect, it } from "vitest"
import { MockSessionView } from "./__fixtures__/mock-session-view.svelte"
import { AgentSession } from "./agent-session.svelte"

it("has no authentication guidance before connecting", () => {
  expect(new AgentSession().authMethods).toEqual([])
})

it("surfaces the provider details when the prompt rejects", async () => {
  const view = new MockSessionView()
  view.connect("test-session")
  view.promptMock.mockRejectedValueOnce({
    code: -32603,
    message: "Internal error",
    data: { details: "Authentication required" },
  })
  const session = new AgentSession({ view })
  session._setStatusForTest("connected")
  session._setSessionContextForTest({
    sessionId: "test-session",
    cwd: "/project",
    cliKind: "claude",
  })

  await session.sendPrompt("hello")

  expect(session.error).toContain("Authentication required")
})
