import { afterEach, describe, expect, it, vi } from "vitest"
import { hostSessionView } from "./__fixtures__/host-session-view"
import { AgentSession } from "./agent-session.svelte"

describe("AgentSession turn state", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("shows the live chunk and waits for an idle update from the host", async () => {
    const host = hostSessionView()
    await host.view.connect()
    const session = new AgentSession({ view: host.view })
    try {
      host.send({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "live chunk" },
        messageId: "m-live",
      })
      await host.settle()
      expect(session.turnState).toBe("responding")
      expect(session.bubbles[0]?.segments.map((segment) => segment.text).join("")).toBe(
        "live chunk",
      )

      host.send({ sessionUpdate: "state_update", state: "idle", stopReason: "end_turn" })
      await host.settle()
      expect(session.turnState).toBe("idle")
    } finally {
      await host.view.close()
    }
  })

  it("asks the view to cancel the active turn and returns to idle", async () => {
    const host = hostSessionView({ turnState: "responding" })
    await host.view.connect()
    const cancel = vi.spyOn(host.view, "cancel").mockResolvedValue(undefined)
    const session = new AgentSession({ view: host.view })
    try {
      expect(session.turnState).toBe("responding")
      await session.cancelTurn()
      expect(cancel).toHaveBeenCalledOnce()
      expect(session.turnState).toBe("idle")
    } finally {
      await host.view.close()
    }
  })

  it("opens a development replay and returns to idle after its last chunk", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          updates: [
            {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "fixture response" },
              messageId: "m-fixture",
            },
          ],
        }),
      ),
    )
    const session = new AgentSession()
    await session.openMockSession("greeting", "/project")

    expect(session.turnState).toBe("idle")
    expect(session.bubbles).toHaveLength(1)
  })
})
