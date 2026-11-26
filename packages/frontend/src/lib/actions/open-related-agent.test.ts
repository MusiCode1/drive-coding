import type { AgentPublic } from "@drive-coding/core"
import { describe, expect, it, vi } from "vitest"
import { openRelatedAgent, relatedAgentBlock } from "./open-related-agent"

type Input = Parameters<typeof openRelatedAgent>[0]
type Session = Input["session"]

function agent(id: string): AgentPublic {
  return {
    id,
    cwd: `/projects/${id}`,
    cliKind: "codex",
    acpSessionId: `${id}-session`,
    modelOverride: null,
    status: "ready",
    createdAt: "",
    persistent: false,
    attached: false,
  }
}

function deferred() {
  let finish: () => void = () => {}
  const promise = new Promise<void>((resolve) => {
    finish = resolve
  })
  return { promise, finish }
}

function setup(initialUrl = "/chat/codex/source-session?sessionTransport=http") {
  const source = agent("source")
  const parent = agent("parent")
  let url = initialUrl
  let sessionId = source.acpSessionId ?? null
  let navigating = false
  const ends = new Set<Parameters<Session["onSessionEnd"]>[0]>()
  function end(reason: Parameters<Parameters<Session["onSessionEnd"]>[0]>[0]) {
    for (const listener of ends) listener(reason)
  }

  const leaveRunning = vi.fn<Session["leaveRunning"]>(async () => {
    end("leave-running")
    session.agentId = null
    sessionId = null
    session.status = "idle"
    session.error = null
  })
  const session: Session = {
    agentId: source.id,
    get sessionId() {
      return sessionId
    },
    sessionTransport: "http",
    status: "connected",
    turnState: "idle",
    pendingPermission: null,
    pendingElicitation: null,
    error: null,
    leaveRunning,
    onSessionEnd(listener) {
      ends.add(listener)
      return () => {
        ends.delete(listener)
      }
    },
  }

  function attach(target: AgentPublic) {
    session.agentId = target.id
    sessionId = target.acpSessionId ?? null
    session.error = null
    session.status = "connected"
  }

  const reconnect = vi.fn<Input["reconnect"]>(async (target) => {
    attach(target)
    return "navigated"
  })
  const goto = vi.fn<Input["goto"]>(async (target) => {
    url = target
  })
  const reopen = vi.fn<Input["reopen"]>()
  const findParent = vi.fn((): AgentPublic | undefined => parent)
  const input: Input = {
    source,
    parent: findParent,
    session,
    reconnect,
    goto,
    reopen,
    currentUrl: () => url,
    isNavigating: () => navigating,
    t: (key) => key,
  }

  return {
    input,
    source,
    parent,
    session,
    attach,
    leaveRunning,
    reconnect,
    findParent,
    goto,
    reopen,
    end,
    setNavigating: (value: boolean) => {
      navigating = value
    },
    setUrl: (value: string) => {
      url = value
    },
  }
}

describe("openRelatedAgent", () => {
  it("leaves the source running and navigates only to the successfully attached parent", async () => {
    const { input, parent, session, leaveRunning, reconnect, goto, reopen, setUrl } = setup()
    goto.mockImplementationOnce(async (url) => {
      expect(session.agentId).toBe(parent.id)
      expect(session.sessionId).toBe(parent.acpSessionId)
      setUrl(url)
    })
    expect(await openRelatedAgent(input)).toBe("navigated")
    expect(leaveRunning).toHaveBeenCalledTimes(1)
    expect(reconnect).toHaveBeenCalledExactlyOnceWith(parent)
    expect(goto).toHaveBeenCalledExactlyOnceWith("/chat/codex/parent-session?sessionTransport=http")
    expect(session.sessionId).toBe(parent.acpSessionId)
    expect(reopen).not.toHaveBeenCalled()
  })

  it("blocks busy or stale sources, pending requests, and parents that cannot reconnect", async () => {
    const { input, parent, source, session, reconnect, leaveRunning, setNavigating } = setup()
    expect(relatedAgentBlock(session, "stale-source", parent, false)).toContain("transition")
    expect(
      relatedAgentBlock(session, source.id, { ...parent, status: "crashed" }, false),
    ).toContain("parentUnavailable")
    expect(
      relatedAgentBlock(session, source.id, { ...parent, acpSessionId: undefined }, false),
    ).toContain("parentUnavailable")

    setNavigating(true)
    expect(await openRelatedAgent(input)).toBe("blocked")
    setNavigating(false)

    session.pendingPermission = {} as NonNullable<Session["pendingPermission"]>
    expect(await openRelatedAgent(input)).toBe("blocked")
    session.pendingPermission = null
    session.pendingElicitation = {} as NonNullable<Session["pendingElicitation"]>
    expect(await openRelatedAgent(input)).toBe("blocked")
    session.pendingElicitation = null
    session.turnState = "thinking"
    expect(await openRelatedAgent(input)).toBe("blocked")
    expect(leaveRunning).not.toHaveBeenCalled()
    expect(reconnect).not.toHaveBeenCalled()
  })

  it.each(["error", "skipped"] as const)(
    "restores the source after parent reconnect returns %s",
    async (outcome) => {
      const { input, source, parent, session, leaveRunning, reconnect, goto, reopen } = setup()
      reconnect.mockImplementationOnce(async () => {
        session.agentId = parent.id
        session.status = "disconnected"
        session.error = "Owner declined attachment"
        return outcome
      })

      expect(await openRelatedAgent(input)).toBe("restored")
      expect(leaveRunning).toHaveBeenCalledTimes(2)
      expect(reconnect.mock.calls).toEqual([[parent], [source]])
      expect(session.agentId).toBe(source.id)
      expect(session.error).toContain("connect.agents.tree.returned")
      expect(session.error).toContain("Owner declined attachment")
      expect(goto).not.toHaveBeenCalled()
      expect(reopen).not.toHaveBeenCalled()
    },
  )

  it("does not reconnect a parent that disappears after leaving the source", async () => {
    const { input, source, findParent, reconnect, goto } = setup()
    findParent.mockReturnValueOnce(agent("parent")).mockReturnValue(undefined)
    expect(await openRelatedAgent(input)).toBe("restored")
    expect(reconnect).toHaveBeenCalledExactlyOnceWith(source)
    expect(goto).not.toHaveBeenCalled()
  })

  it.each(["cancelled", "rejected"] as const)(
    "restores the source when goto is %s after attach",
    async (reason) => {
      const { input, source, parent, session, leaveRunning, reconnect, goto } = setup()
      goto.mockImplementationOnce(async () => {
        expect(session.agentId).toBe(parent.id)
        if (reason === "rejected") throw new Error("Router rejected navigation")
      })

      expect(await openRelatedAgent(input)).toBe("restored")
      expect(reconnect.mock.calls).toEqual([[parent], [source]])
      expect(leaveRunning).toHaveBeenCalledTimes(2)
      expect(session.agentId).toBe(source.id)
      expect(session.error).toContain("connect.agents.tree.returned")
    },
  )

  it("reopens the direct source address when both attaches leave the screen idle", async () => {
    const { input, session, reconnect, reopen, goto } = setup("/chat")
    reconnect.mockResolvedValueOnce("error").mockResolvedValueOnce("skipped")

    expect(await openRelatedAgent(input)).toBe("failed")
    const address = "/chat/codex/source-session?sessionTransport=http"
    expect(reopen).toHaveBeenCalledExactlyOnceWith(address)
    expect(goto).not.toHaveBeenCalled()
    expect(session.error).toContain(address)
  })

  it("leaves a competing navigation and its error alone during target attachment", async () => {
    const { input, parent, session, reconnect, goto, setUrl, attach } = setup()
    const pending = deferred()
    reconnect.mockImplementationOnce(async () => {
      await pending.promise
      return "skipped"
    })
    const move = openRelatedAgent(input)
    await vi.waitFor(() => expect(reconnect).toHaveBeenCalledExactlyOnceWith(parent))
    attach(agent("other"))
    setUrl("/chat/codex/other-session")
    session.error = "Competing error"
    pending.finish()

    expect(await move).toBe("superseded")
    expect(goto).not.toHaveBeenCalled()
    expect(reconnect).toHaveBeenCalledTimes(1)
    expect(session.error).toBe("Competing error")
  })

  it("does not take over a competing transition during recovery, even at the same URL", async () => {
    const { input, source, session, reconnect, goto, reopen, end } = setup()
    const pending = deferred()
    reconnect.mockResolvedValueOnce("skipped").mockImplementationOnce(async () => {
      await pending.promise
      return "error"
    })
    const move = openRelatedAgent(input)
    await vi.waitFor(() => expect(reconnect).toHaveBeenLastCalledWith(source))
    end("switch")
    session.error = "Competing recovery error"
    pending.finish()

    expect(await move).toBe("superseded")
    expect(goto).not.toHaveBeenCalled()
    expect(reopen).not.toHaveBeenCalled()
    expect(session.error).toBe("Competing recovery error")
  })

  it("blocks a second invocation before the first navigation completes", async () => {
    const { input, reconnect, goto } = setup()
    const pending = deferred()
    reconnect.mockImplementationOnce(async () => {
      await pending.promise
      return "skipped"
    })
    const move = openRelatedAgent(input)
    expect(await openRelatedAgent(input)).toBe("blocked")
    pending.finish()
    expect(await move).toBe("restored")
    expect(goto).not.toHaveBeenCalled()
  })
})
