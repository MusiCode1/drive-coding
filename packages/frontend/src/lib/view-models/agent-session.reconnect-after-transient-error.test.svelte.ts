import { describe, expect, test } from "vitest"
import { AgentSession } from "./agent-session.svelte"

describe("AgentSession — _onSseReconnectedForTest", () => {
  test("מנקה switchSession failed כש-#errorSurfaced=false", () => {
    const session = new AgentSession()
    session.error = "switchSession failed: boom"

    session._onSseReconnectedForTest()

    expect(session.error).toBeNull()
  })

  test("שומר שגיאה טרמינלית כש-#errorSurfaced=true (attach/loadSession)", () => {
    const session = new AgentSession()
    session._setErrorSurfacedForTest(true)
    session.error = "Cannot find module '@anthropic-ai/claude-agent-sdk'"

    session._onSseReconnectedForTest()

    expect(session.error).toBe("Cannot find module '@anthropic-ai/claude-agent-sdk'")
  })

  test("שומר switchSession failed כש-#errorSurfaced=true", () => {
    const session = new AgentSession()
    session._setErrorSurfacedForTest(true)
    session.error = "switchSession failed: boom"

    session._onSseReconnectedForTest()

    expect(session.error).toBe("switchSession failed: boom")
  })

  test("שומר שגיאה אחרת כש-#errorSurfaced=true", () => {
    const session = new AgentSession()
    session._setErrorSurfacedForTest(true)
    session.error = "newSession failed: boom"

    session._onSseReconnectedForTest()

    expect(session.error).toBe("newSession failed: boom")
  })
})
