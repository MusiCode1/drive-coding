import type { AcpClient, createAcpClient } from "@drive-coding/provider/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createAgent, deleteAgent, getAgent, listAgents } from "$lib/adapters/agents-api"
import { createRemoteView } from "./create-session-view"
import { HttpConnection, type HttpConnectionDeps } from "./http-connection"
import type { LocalSessionView } from "./local-session-view"
import type { SessionView } from "./session-view"
import { WsConnection, type WsConnectionDeps, type WsReconnectDeps } from "./ws-connection"

const events: string[] = []
const waitBehaviors: Array<(close: (code: number, reason: string) => void) => Promise<void>> = []
const closeWaitBehaviors: Array<() => Promise<void>> = []
const client = {
  authMethods: [],
  loadSession: vi.fn(async () => ({ sessionId: "session-1" })),
  newSession: vi.fn(async () => {
    events.push("newSession")
    return { sessionId: "session-1" }
  }),
} as unknown as AcpClient

vi.mock("@drive-coding/acp-wire/browser", () => ({
  WsAcpTransport: class {
    #onClose: Array<(code: number, reason: string) => void> = []
    constructor() {
      events.push("WsAcpTransport")
    }
    onClose = vi.fn((callback: (code: number, reason: string) => void) => {
      this.#onClose.push(callback)
    })
    async waitForOpen() {
      events.push("waitForOpen")
      const behavior = waitBehaviors.shift()
      if (behavior)
        await behavior((code, reason) => {
          for (const callback of this.#onClose) callback(code, reason)
        })
    }
    close() {
      events.push("close")
    }
    async closeAndWait() {
      events.push("closeAndWait")
      await closeWaitBehaviors.shift()?.()
      events.push("closeAndWaitDone")
    }
  },
}))
vi.mock("@drive-coding/provider/client", () => ({
  createAcpClient: vi.fn(async () => {
    events.push("createAcpClient")
    return client
  }),
  createAttachedAcpClient: vi.fn(() => {
    events.push("createAttachedAcpClient")
    return client
  }),
}))
vi.mock("$lib/adapters/agents-api", () => ({
  createAgent: vi.fn(async () => {
    events.push("createAgent")
    return { agentId: "agent-1" }
  }),
  notifySessionAttached: vi.fn(async () => {
    events.push("notifySessionAttached")
  }),
  listAgents: vi.fn(async () => {
    events.push("listAgents")
    return []
  }),
  getAgent: vi.fn(async () => null),
  deleteAgent: vi.fn(async () => {
    events.push("deleteAgent")
  }),
}))
vi.mock("./create-session-view", () => ({
  createRemoteView: vi.fn(),
}))

function wsDeps(): WsConnectionDeps {
  return {
    prepareNew: vi.fn(),
    setAgent: vi.fn(() => {
      events.push("setAgent")
    }),
    url: vi.fn(() => "ws://localhost/agent-1"),
    setTransport: vi.fn(() => {
      events.push("setTransport")
    }),
    onClose: vi.fn(),
    bindLocalView: vi.fn(() => {
      events.push("bindLocalView")
      return {} as LocalSessionView
    }),
    callbacks: vi.fn(() => ({}) as Parameters<typeof createAcpClient>[1]),
    setClient: vi.fn(),
    sessionMeta: vi.fn(() => undefined),
    enterSession: vi.fn(),
    adoptLocalView: vi.fn(() => {
      events.push("adoptLocalView")
    }),
    captureSessionConfig: vi.fn(),
    connected: vi.fn(async () => {
      events.push("connected")
    }),
    failed: vi.fn(),
    openExisting: vi.fn(),
  }
}

function httpDeps(): HttpConnectionDeps {
  return {
    prepare: vi.fn(),
    setAgent: vi.fn(() => {
      events.push("setAgent")
    }),
    viewOptions: vi.fn(() => ({ headers: {}, onSseReconnected: vi.fn() })),
    enterSession: vi.fn(),
    bindView: vi.fn(),
    applyTitle: vi.fn(),
    connected: vi.fn(async () => {
      events.push("connected")
    }),
    rememberedConfig: vi.fn(async () => {}),
    failed: vi.fn(),
    missingSessionId: vi.fn(),
  }
}

beforeEach(() => {
  events.length = 0
  waitBehaviors.length = 0
  closeWaitBehaviors.length = 0
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

function reconnectDeps(): WsConnectionDeps & { reconnect: WsReconnectDeps } {
  return {
    ...wsDeps(),
    reconnect: {
      context: vi.fn(() => ({
        sessionId: "session-1",
        cwd: "/repo",
        cliKind: "claude",
        agentId: "old-agent",
        hidden: false,
        detached: false,
        tearingDown: false,
        remote: false,
        terminalError: false,
      })),
      snapshot: vi.fn(),
      setStatus: vi.fn(),
      setAttempt: vi.fn(),
      setTerminal: vi.fn(),
      clearTransientError: vi.fn(),
      clearClient: vi.fn(),
      prepareWarm: vi.fn(),
      setAttachedClient: vi.fn(),
      startReplay: vi.fn(),
      finishReplay: vi.fn(),
      disposeFailedWarm: vi.fn(),
      cold: vi.fn(async () => ({ kind: "failed" as const, preservedSessionId: "session-1" })),
      connected: vi.fn(),
    },
  }
}

describe("Connection transport ownership", () => {
  it("exposes reconnect and cancellation from the connection owner", () => {
    const ws = new WsConnection(wsDeps())
    const http = new HttpConnection(httpDeps())
    expect(typeof ws.reconnect).toBe("function")
    expect(typeof ws.cancelReconnect).toBe("function")
    expect(typeof http.reconnect).toBe("function")
    expect(typeof http.cancelReconnect).toBe("function")
  })

  it("WS opens and waits, binds the observer before client creation, then adopts the session", async () => {
    const deps = wsDeps()
    await new WsConnection(deps).open({ kind: "new", cwd: "/repo", cliKind: "claude" })
    expect(events).toEqual([
      "createAgent",
      "setAgent",
      "WsAcpTransport",
      "setTransport",
      "waitForOpen",
      "bindLocalView",
      "createAcpClient",
      "newSession",
      "adoptLocalView",
      "notifySessionAttached",
      "connected",
    ])
    expect(deps.enterSession).toHaveBeenCalledWith("session-1")
    expect(deps.failed).not.toHaveBeenCalled()
  })

  it("rejects a missing existing WS sessionId before mutating the VM", async () => {
    const deps = wsDeps()
    await expect(
      new WsConnection(deps).open({
        kind: "existing-ws",
        agentId: "live",
        sessionId: "",
        cwd: "/repo",
        cliKind: "claude",
      }),
    ).rejects.toThrow("requires sessionId")
    expect(deps.openExisting).not.toHaveBeenCalled()
    expect(deps.prepareNew).not.toHaveBeenCalled()
    expect(events).not.toContain("WsAcpTransport")
  })

  it("HTTP new creates an agent before opening SSE and never constructs WS", async () => {
    vi.mocked(createRemoteView).mockImplementationOnce(async () => {
      events.push("createRemoteView")
      return { state: { sessionId: "from-snapshot" } } as SessionView as Awaited<
        ReturnType<typeof createRemoteView>
      >
    })
    const deps = httpDeps()
    await new HttpConnection(deps).open({ kind: "new", cwd: "/repo", cliKind: "claude" })
    expect(events).toEqual(["createAgent", "setAgent", "createRemoteView", "connected"])
    expect(deps.enterSession).toHaveBeenCalledWith("from-snapshot")
    expect(deps.rememberedConfig).toHaveBeenCalledOnce()
    expect(events).not.toContain("WsAcpTransport")
  })

  it("HTTP existing preserves the live agent on missing snapshot sessionId", async () => {
    const close = vi.fn(async () => {})
    vi.mocked(createRemoteView).mockResolvedValueOnce({
      state: { sessionId: null },
      close,
    } as unknown as Awaited<ReturnType<typeof createRemoteView>>)
    const deps = httpDeps()
    await new HttpConnection(deps).open({
      kind: "existing-http",
      agentId: "live",
      cwd: "/repo",
      cliKind: "claude",
    })
    expect(createAgent).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
    expect(deps.missingSessionId).toHaveBeenCalledWith(true)
    expect(deps.connected).not.toHaveBeenCalled()
    expect(events).not.toContain("WsAcpTransport")
  })

  it("HTTP new removes its own agent on a failed SSE connection", async () => {
    const error = new Error("SSE failed")
    vi.mocked(createRemoteView).mockRejectedValueOnce(error)
    const deps = httpDeps()
    await new HttpConnection(deps).open({ kind: "new", cwd: "/repo", cliKind: "claude" })
    expect(deps.failed).toHaveBeenCalledWith(error, false)
    expect(events).not.toContain("WsAcpTransport")
  })
})

describe("Connection reconnect policy", () => {
  it("retries a transient 1008 warm handshake, then completes replay without cold", async () => {
    const deps = reconnectDeps()
    vi.mocked(listAgents).mockResolvedValueOnce([
      {
        id: "old-agent",
        acpSessionId: "session-1",
        cwd: "/repo",
        status: "ready",
      },
    ] as unknown as Awaited<ReturnType<typeof listAgents>>)
    waitBehaviors.push(async (close) => {
      close(1008, "temporary ownership")
      await new Promise<void>(() => {})
    })
    await new WsConnection(deps).reconnect()
    expect(events.filter((event) => event === "WsAcpTransport")).toHaveLength(2)
    expect(events).toContain("createAttachedAcpClient")
    expect(deps.reconnect.cold).not.toHaveBeenCalled()
    expect(deps.reconnect.setStatus).toHaveBeenLastCalledWith("connected")
    expect(deps.reconnect.connected).toHaveBeenCalledOnce()
  })

  it("waits for a transient 1008 WS to close before constructing its replacement", async () => {
    const deps = reconnectDeps()
    vi.mocked(listAgents).mockResolvedValueOnce([
      {
        id: "old-agent",
        acpSessionId: "session-1",
        cwd: "/repo",
        status: "ready",
      },
    ] as unknown as Awaited<ReturnType<typeof listAgents>>)
    waitBehaviors.push(async (close) => {
      close(1008, "temporary ownership")
      await new Promise<void>(() => {})
    })
    let releaseClose!: () => void
    closeWaitBehaviors.push(
      () =>
        new Promise<void>((resolve) => {
          releaseClose = resolve
        }),
    )
    const pending = new WsConnection(deps).reconnect()
    await vi.waitFor(() => expect(events).toContain("closeAndWait"))
    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(events.filter((event) => event === "WsAcpTransport")).toHaveLength(1)
    expect(events).toContain("closeAndWait")
    releaseClose()
    await pending
    expect(events.indexOf("closeAndWaitDone")).toBeLessThan(events.lastIndexOf("WsAcpTransport"))
  })

  it("deletes the old agent only after an explicit successful cold result", async () => {
    const deps = reconnectDeps()
    vi.mocked(deps.reconnect.cold).mockResolvedValueOnce({
      kind: "connected",
      agentId: "new-agent",
    })
    await new WsConnection(deps).reconnect()
    expect(deleteAgent).toHaveBeenCalledWith("old-agent")
    expect(deps.reconnect.connected).toHaveBeenCalledOnce()
  })

  it("skips detached, remote and missing context without a WS or new agent", async () => {
    const deps = reconnectDeps()
    const connection = new WsConnection(deps)
    vi.mocked(deps.reconnect.context).mockReturnValueOnce(null)
    await connection.reconnect()
    vi.mocked(deps.reconnect.context).mockImplementation(() => ({
      sessionId: "session-1",
      cwd: "/repo",
      cliKind: "claude",
      agentId: "old-agent",
      hidden: false,
      detached: true,
      tearingDown: false,
      remote: false,
      terminalError: false,
    }))
    await connection.reconnect()
    expect(events).not.toContain("WsAcpTransport")
    expect(listAgents).not.toHaveBeenCalled()
    expect(createAgent).not.toHaveBeenCalled()
  })

  it("holds terminal host-active warm close out of cold and backoff", async () => {
    const deps = reconnectDeps()
    vi.mocked(listAgents).mockResolvedValueOnce([
      {
        id: "old-agent",
        acpSessionId: "session-1",
        cwd: "/repo",
        status: "ready",
      },
    ] as unknown as Awaited<ReturnType<typeof listAgents>>)
    waitBehaviors.push(async (close) => {
      close(1008, "session-host-active")
      await new Promise<void>(() => {})
    })
    await new WsConnection(deps).reconnect()
    expect(deps.reconnect.setTerminal).toHaveBeenCalledWith("host-active")
    expect(deps.reconnect.cold).not.toHaveBeenCalled()
    expect(events.filter((event) => event === "WsAcpTransport")).toHaveLength(1)
  })

  it("discards a warm WS whose waitForOpen resolves after cancellation", async () => {
    const deps = reconnectDeps()
    vi.mocked(listAgents).mockResolvedValueOnce([
      {
        id: "old-agent",
        acpSessionId: "session-1",
        cwd: "/repo",
        status: "ready",
      },
    ] as unknown as Awaited<ReturnType<typeof listAgents>>)
    let release!: () => void
    waitBehaviors.push(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    const connection = new WsConnection(deps)
    const pending = connection.reconnect()
    await vi.waitFor(() => expect(events).toContain("waitForOpen"))
    connection.cancelReconnect()
    release()
    await pending
    expect(events).toContain("close")
    expect(deps.reconnect.setAttachedClient).not.toHaveBeenCalled()
    expect(deps.reconnect.cold).not.toHaveBeenCalled()
  })

  it("settles an active waitForOpen when manual cancellation arrives", async () => {
    const deps = reconnectDeps()
    vi.mocked(listAgents).mockResolvedValueOnce([
      {
        id: "old-agent",
        acpSessionId: "session-1",
        cwd: "/repo",
        status: "ready",
      },
    ] as unknown as Awaited<ReturnType<typeof listAgents>>)
    waitBehaviors.push(() => new Promise<void>(() => {}))
    const connection = new WsConnection(deps)
    const settled = vi.fn()
    void connection.reconnect().then(settled)
    await vi.waitFor(() => expect(events).toContain("waitForOpen"))
    connection.cancelReconnect()
    await vi.waitFor(() => expect(settled).toHaveBeenCalledOnce(), { timeout: 100 })
    expect(events).toContain("close")
  })

  it("closes the owned WS before looking for a reusable agent", async () => {
    const deps = reconnectDeps()
    const connection = new WsConnection(deps)
    connection.adoptTransport({
      closeAndWait: vi.fn(async () => {
        events.push("closeAndWait")
      }),
    } as unknown as import("@drive-coding/acp-wire/browser").WsAcpTransport)
    await connection.reconnect()
    expect(events.indexOf("closeAndWait")).toBeLessThan(events.indexOf("listAgents"))
    expect(deps.reconnect.clearClient).toHaveBeenCalledOnce()
  })

  it("keeps the old agent after failed cold and removes only the new failed agent", async () => {
    const deps = reconnectDeps()
    vi.mocked(deps.reconnect.cold).mockResolvedValueOnce({
      kind: "failed",
      preservedSessionId: "session-1",
      failedAgentId: "new-failed-agent",
    })
    await new WsConnection(deps).reconnect()
    expect(deleteAgent).toHaveBeenCalledWith("new-failed-agent")
    expect(deleteAgent).not.toHaveBeenCalledWith("old-agent")
    expect(deps.reconnect.connected).not.toHaveBeenCalled()
  })

  it("cancels a pending backoff wait without a later WS attempt", async () => {
    vi.useFakeTimers()
    const deps = reconnectDeps()
    const connection = new WsConnection(deps)
    await connection.onUnexpectedClose(1006, "")
    connection.cancelReconnect()
    await vi.runAllTimersAsync()
    expect(listAgents).not.toHaveBeenCalled()
    expect(deps.reconnect.setAttempt).toHaveBeenLastCalledWith(0)
  })

  it("discards a stale listAgents result after a newer manual attempt", async () => {
    const deps = reconnectDeps()
    let release!: (agents: []) => void
    vi.mocked(listAgents)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve
          }),
      )
      .mockResolvedValueOnce([])
    const connection = new WsConnection(deps)
    const stale = connection.reconnect()
    const current = connection.reconnect()
    release([])
    await Promise.all([stale, current])
    expect(deps.reconnect.cold).toHaveBeenCalledOnce()
  })

  it("does not recover from takeover or a host-active terminal close", async () => {
    const deps = reconnectDeps()
    const connection = new WsConnection(deps)
    await connection.onUnexpectedClose(4409, "")
    await connection.onUnexpectedClose(1008, "session-host-active")
    expect(deps.reconnect.setTerminal).toHaveBeenNthCalledWith(1, "takeover")
    expect(deps.reconnect.setTerminal).toHaveBeenNthCalledWith(2, "host-active")
    expect(listAgents).not.toHaveBeenCalled()
  })

  it("does not reconnect after a surfaced crashReason", async () => {
    const deps = reconnectDeps()
    vi.mocked(getAgent).mockResolvedValueOnce({
      agent: { status: "crashed", crashReason: "agent crashed" },
    } as Awaited<ReturnType<typeof getAgent>>)
    await new WsConnection(deps).onUnexpectedClose(1006, "")
    expect(deps.reconnect.setTerminal).toHaveBeenCalledWith("crash", "agent crashed")
    expect(listAgents).not.toHaveBeenCalled()
  })

  it.each(["detached", "tearingDown"] as const)(
    "ignores a pending crash result after context becomes %s",
    async (state) => {
      const deps = reconnectDeps()
      const context = {
        sessionId: "session-1",
        cwd: "/repo",
        cliKind: "claude",
        agentId: "old-agent",
        hidden: false,
        detached: false,
        tearingDown: false,
        remote: false,
        terminalError: false,
      }
      vi.mocked(deps.reconnect.context).mockReturnValue(context)
      let releaseAgent!: (value: Awaited<ReturnType<typeof getAgent>>) => void
      vi.mocked(getAgent).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseAgent = resolve
          }),
      )
      const pending = new WsConnection(deps).onUnexpectedClose(1006, "")
      await vi.waitFor(() => expect(getAgent).toHaveBeenCalledOnce())
      context[state] = true
      releaseAgent({
        agent: { status: "crashed", crashReason: "agent crashed" },
      } as Awaited<ReturnType<typeof getAgent>>)
      await pending
      expect(deps.reconnect.setTerminal).not.toHaveBeenCalled()
      expect(deps.reconnect.clearTransientError).not.toHaveBeenCalled()
      expect(deps.reconnect.setStatus).not.toHaveBeenCalled()
      expect(deps.reconnect.setAttempt).not.toHaveBeenCalled()
    },
  )

  it.each(["detached", "tearingDown"] as const)(
    "does not set disconnected after context becomes %s during getAgent",
    async (state) => {
      const deps = reconnectDeps()
      const context = {
        sessionId: "session-1",
        cwd: "/repo",
        cliKind: "claude",
        agentId: "old-agent",
        hidden: false,
        detached: false,
        tearingDown: false,
        remote: false,
        terminalError: false,
      }
      vi.mocked(deps.reconnect.context).mockReturnValue(context)
      let releaseAgent!: (value: Awaited<ReturnType<typeof getAgent>>) => void
      vi.mocked(getAgent).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseAgent = resolve
          }),
      )
      const pending = new WsConnection(deps).onUnexpectedClose(1006, "")
      await vi.waitFor(() => expect(getAgent).toHaveBeenCalledOnce())
      context[state] = true
      releaseAgent({
        agent: { status: "ready", cwd: "/repo" },
      } as Awaited<ReturnType<typeof getAgent>>)
      await pending
      expect(deps.reconnect.setTerminal).not.toHaveBeenCalled()
      expect(deps.reconnect.clearTransientError).not.toHaveBeenCalled()
      expect(deps.reconnect.setStatus).not.toHaveBeenCalled()
      expect(deps.reconnect.setAttempt).not.toHaveBeenCalled()
    },
  )

  it("keeps HTTP reconnect a no-op", async () => {
    const connection = new HttpConnection(httpDeps())
    await connection.reconnect()
    connection.cancelReconnect()
    expect(events).not.toContain("WsAcpTransport")
    expect(createAgent).not.toHaveBeenCalled()
  })
})
