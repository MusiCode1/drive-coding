import type { AcpClient, createAcpClient } from "@drive-coding/provider/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createAgent } from "$lib/adapters/agents-api"
import { createRemoteView } from "./create-session-view"
import { HttpConnection, type HttpConnectionDeps } from "./http-connection"
import type { LocalSessionView } from "./local-session-view"
import type { SessionView } from "./session-view"
import { WsConnection, type WsConnectionDeps } from "./ws-connection"

const events: string[] = []
const client = {
  authMethods: [],
  newSession: vi.fn(async () => {
    events.push("newSession")
    return { sessionId: "session-1" }
  }),
} as unknown as AcpClient

vi.mock("@drive-coding/acp-wire/browser", () => ({
  WsAcpTransport: class {
    constructor() {
      events.push("WsAcpTransport")
    }
    onClose = vi.fn()
    async waitForOpen() {
      events.push("waitForOpen")
    }
  },
}))
vi.mock("@drive-coding/provider/client", () => ({
  createAcpClient: vi.fn(async () => {
    events.push("createAcpClient")
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
    release: vi.fn(async () => {}),
  }
}

beforeEach(() => {
  events.length = 0
  vi.clearAllMocks()
})

describe("Connection transport ownership", () => {
  it("WS preserves an agent by sending detach before closing its owned client", async () => {
    const deps = wsDeps()
    const connection = new WsConnection(deps)
    const sendRaw = vi.fn(() => events.push("detach"))
    const close = vi.fn(() => events.push("close"))
    connection.adoptTransport({ sendRaw, close } as never)
    connection.adoptClient({ close } as never)
    await connection.close({ kind: "preserve-agent", reason: "navigate" })
    expect(events).toEqual(["detach", "close"])
    expect(sendRaw).toHaveBeenCalledWith(expect.stringContaining('"method":"$/detach"'))
  })

  it("WS still closes after detach send fails and only closes once", async () => {
    const connection = new WsConnection(wsDeps())
    const close = vi.fn()
    connection.adoptTransport({
      sendRaw: () => {
        throw new Error("closed")
      },
      close,
    } as never)
    await connection.close({ kind: "preserve-agent", reason: "leave-running" })
    await connection.close({ kind: "preserve-agent", reason: "leave-running" })
    expect(close).toHaveBeenCalledOnce()
  })

  it("WS closes the client during the interval between view creation and view adoption", async () => {
    const connection = new WsConnection(wsDeps())
    const close = vi.fn()
    const viewClose = vi.fn(async () => {})
    connection.adoptTransport({ sendRaw: vi.fn(), close } as never)
    connection.adoptClient({ close } as never)
    connection.adoptView({ close: viewClose } as never)
    await connection.close({ kind: "terminate-agent", reason: "detach" })
    expect(viewClose).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })

  it("WS closes the client if an adopted view throws during close", async () => {
    const connection = new WsConnection(wsDeps())
    const close = vi.fn()
    connection.adoptTransport({ sendRaw: vi.fn(), close } as never)
    connection.adoptClient({ close } as never)
    connection.adoptView({
      close: async () => {
        throw new Error("view failed")
      },
    } as never)
    connection.markViewReady()
    await connection.close({ kind: "terminate-agent", reason: "detach" })
    expect(close).toHaveBeenCalledOnce()
  })

  it("WS does not close the client twice after an adopted view closes it", async () => {
    const connection = new WsConnection(wsDeps())
    const close = vi.fn()
    connection.adoptTransport({ sendRaw: vi.fn(), close } as never)
    connection.adoptClient({ close } as never)
    connection.adoptView({
      close: async () => {
        close()
      },
    } as never)
    connection.markViewReady()
    await connection.close({ kind: "terminate-agent", reason: "detach" })
    expect(close).toHaveBeenCalledOnce()
  })

  it("HTTP waits for its view before releasing, and does not release when terminating", async () => {
    const deps = httpDeps()
    const release = vi.fn(async () => {
      events.push("release")
    })
    deps.release = release
    const connection = new HttpConnection(deps)
    connection.adoptView(
      {
        close: async () => {
          events.push("reply")
          events.push("sse-close")
        },
      } as never,
      "agent-1",
    )
    await connection.close({ kind: "preserve-agent", reason: "navigate" })
    expect(events).toEqual(["reply", "sse-close", "release"])
    await connection.close({ kind: "preserve-agent", reason: "navigate" })
    expect(release).toHaveBeenCalledOnce()
    const terminated = new HttpConnection(deps)
    terminated.adoptView({ close: async () => events.push("terminated-close") } as never, "agent-2")
    await terminated.close({ kind: "terminate-agent", reason: "detach" })
    expect(release).toHaveBeenCalledOnce()
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
