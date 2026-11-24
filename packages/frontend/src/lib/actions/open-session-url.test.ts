/**
 * open-session-url.test.ts — integration tests for session URL resolver (slice session-url C2).
 */

import type { AgentPublic } from "@drive-coding/core/schemas/agent"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SessionInfo } from "$lib/adapters/sessions"
import { createRemoteView } from "$lib/session/create-session-view"
import { MockSessionView } from "$lib/view-models/__fixtures__/mock-session-view.svelte"
import { AgentSession } from "$lib/view-models/agent-session.svelte"
import { openSessionUrl } from "./open-session-url.js"

const listAgentsMock = vi.fn<() => Promise<AgentPublic[]>>()
const openSessionColdMock =
  vi.fn<
    (params: {
      cliKind: string
      sessionId: string
      session: unknown
      settings: unknown
    }) => Promise<string>
  >()

vi.mock("$lib/adapters/agents-api", () => ({
  listAgents: () => listAgentsMock(),
}))

vi.mock("./open-session-cold.js", () => ({
  openSessionCold: (params: {
    cliKind: string
    sessionId: string
    session: unknown
    settings: unknown
  }) => openSessionColdMock(params),
}))

vi.mock("$env/dynamic/public", () => ({
  env: { PUBLIC_SESSION_TRANSPORT: undefined },
}))

type MockSessionsCache = {
  sessions: SessionInfo[]
  error: string | null
}

type MockSession = {
  status: string
  cliKind: string | null
  sessionId: string | null
  agentId: string | null
  error: string | null
  turnState: string
  sessionsCache: MockSessionsCache
  listSessions: ReturnType<typeof vi.fn>
  switchSession: ReturnType<typeof vi.fn>
  attachRemoteToLiveAgent: ReturnType<typeof vi.fn>
}

function makeAgent(overrides: Partial<AgentPublic> & Pick<AgentPublic, "id">): AgentPublic {
  return {
    cliKind: "claude",
    cwd: "/tmp",
    modelOverride: null,
    status: "ready",
    createdAt: "2026-01-01T00:00:00.000Z",
    acpSessionId: "sess-target",
    attached: false,
    ...overrides,
  }
}

function makeSession(overrides: Partial<MockSession> = {}): MockSession {
  const { sessionsCache: cacheOverride, ...rest } = overrides
  return {
    status: "idle",
    cliKind: null,
    sessionId: null,
    agentId: null,
    error: null,
    turnState: "idle",
    sessionsCache: { sessions: [], error: null, ...cacheOverride },
    listSessions: vi.fn(async () => {}),
    switchSession: vi.fn(async () => {}),
    attachRemoteToLiveAgent: vi.fn(async () => {}),
    ...rest,
  }
}

vi.mock("$lib/session/create-session-view")

beforeEach(() => {
  vi.mocked(createRemoteView).mockReset()
  listAgentsMock.mockReset()
  openSessionColdMock.mockReset()
  vi.stubGlobal("location", { search: "", protocol: "http:", host: "localhost" })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("openSessionUrl", () => {
  it("returns connected when already on the same session", async () => {
    const session = makeSession({
      status: "connected",
      sessionId: "sess-a",
      cliKind: "claude",
    })
    expect(
      await openSessionUrl({
        cliKind: "claude",
        sessionId: "sess-a",
        session: session as never,
        settings: { sessionTransport: null } as never,
      }),
    ).toBe("connected")
    expect(session.listSessions).not.toHaveBeenCalled()
  })

  it("returns connected when disconnected but same sessionId", async () => {
    const session = makeSession({
      status: "disconnected",
      sessionId: "sess-a",
      cliKind: "claude",
    })
    expect(
      await openSessionUrl({
        cliKind: "claude",
        sessionId: "sess-a",
        session: session as never,
        settings: { sessionTransport: null } as never,
      }),
    ).toBe("connected")
  })

  it("returns busy when connected tab has active turn", async () => {
    const session = makeSession({
      status: "connected",
      cliKind: "claude",
      sessionId: "sess-a",
      turnState: "responding",
    })
    expect(
      await openSessionUrl({
        cliKind: "claude",
        sessionId: "sess-b",
        session: session as never,
        settings: { sessionTransport: null } as never,
      }),
    ).toBe("busy")
    expect(session.listSessions).not.toHaveBeenCalled()
    expect(session.switchSession).not.toHaveBeenCalled()
  })

  it("switches session when connected to same cliKind", async () => {
    const session = makeSession({
      status: "connected",
      cliKind: "claude",
      sessionId: "other",
      sessionsCache: {
        sessions: [{ sessionId: "sess-b", cwd: "/proj", title: "B", updatedAt: "" }],
        error: null,
      },
    })
    session.switchSession.mockImplementation(async () => {
      session.sessionId = "sess-b"
    })

    expect(
      await openSessionUrl({
        cliKind: "claude",
        sessionId: "sess-b",
        session: session as never,
        settings: { sessionTransport: null } as never,
      }),
    ).toBe("connected")
    expect(session.listSessions).toHaveBeenCalledWith(true)
    expect(session.switchSession).toHaveBeenCalledWith({
      sessionId: "sess-b",
      cwd: "/proj",
      cliKind: "claude",
      title: "B",
    })
  })

  it("returns error when listSessions fails", async () => {
    const session = makeSession({
      status: "connected",
      cliKind: "claude",
      sessionsCache: { sessions: [], error: "network down" },
    })
    expect(
      await openSessionUrl({
        cliKind: "claude",
        sessionId: "sess-b",
        session: session as never,
        settings: { sessionTransport: null } as never,
      }),
    ).toBe("error")
  })

  it("returns not-found when session missing from list", async () => {
    const session = makeSession({
      status: "connected",
      cliKind: "claude",
      sessionsCache: { sessions: [], error: null },
    })
    expect(
      await openSessionUrl({
        cliKind: "claude",
        sessionId: "missing",
        session: session as never,
        settings: { sessionTransport: null } as never,
      }),
    ).toBe("not-found")
  })

  it("returns error when switchSession throws", async () => {
    const session = makeSession({
      status: "connected",
      cliKind: "claude",
      sessionsCache: {
        sessions: [{ sessionId: "sess-b", cwd: "/proj", title: "", updatedAt: "" }],
        error: null,
      },
    })
    session.switchSession.mockRejectedValue(new Error("cannot switchSession in status connecting"))

    expect(
      await openSessionUrl({
        cliKind: "claude",
        sessionId: "sess-b",
        session: session as never,
        settings: { sessionTransport: null } as never,
      }),
    ).toBe("error")
  })

  it("returns error when switchSession leaves session in error state", async () => {
    const session = makeSession({
      status: "connected",
      cliKind: "claude",
      sessionsCache: {
        sessions: [{ sessionId: "sess-b", cwd: "/proj", title: "", updatedAt: "" }],
        error: null,
      },
    })
    session.switchSession.mockImplementation(async () => {
      session.status = "error"
      session.error = "switchSession failed: boom"
    })

    expect(
      await openSessionUrl({
        cliKind: "claude",
        sessionId: "sess-b",
        session: session as never,
        settings: { sessionTransport: null } as never,
      }),
    ).toBe("error")
  })

  it("delegates to openSessionCold when pick is none", async () => {
    listAgentsMock.mockResolvedValue([])
    openSessionColdMock.mockResolvedValue("not-found")
    const session = makeSession()
    const settings = { sessionTransport: null } as never
    expect(
      await openSessionUrl({
        cliKind: "claude",
        sessionId: "sess-x",
        session: session as never,
        settings,
      }),
    ).toBe("not-found")
    expect(openSessionColdMock).toHaveBeenCalledWith({
      cliKind: "claude",
      sessionId: "sess-x",
      session,
      settings,
    })
  })

  it("joins a WebSocket-attached agent without confirmation", async () => {
    const agent = makeAgent({
      id: "00000000-0000-4000-8000-000000000002",
      attached: true,
      attachedVia: "ws",
    })
    listAgentsMock.mockResolvedValue([agent])
    const session = makeSession()
    session.attachRemoteToLiveAgent.mockImplementation(async () => {
      session.status = "connected"
      session.agentId = agent.id
    })

    expect(
      await openSessionUrl({
        cliKind: "claude",
        sessionId: "sess-target",
        session: session as never,
        settings: { sessionTransport: "ws" } as never,
      }),
    ).toBe("connected")
    expect(session.attachRemoteToLiveAgent).toHaveBeenCalledExactlyOnceWith({
      agentId: agent.id,
      cwd: agent.cwd,
      cliKind: agent.cliKind,
      transport: "ws",
    })
  })

  it.each(["ws", "http"] as const)("attaches to the matched agent via %s", async (transport) => {
    const agent = makeAgent({
      id: "00000000-0000-4000-8000-000000000004",
      acpSessionId: "sess-target",
    })
    listAgentsMock.mockResolvedValue([agent])
    const view = new MockSessionView()
    view.connect("sess-target")
    vi.mocked(createRemoteView).mockResolvedValue(
      view as unknown as Awaited<ReturnType<typeof createRemoteView>>,
    )
    const session = new AgentSession()

    expect(
      await openSessionUrl({
        cliKind: "claude",
        sessionId: "sess-target",
        session,
        settings: { sessionTransport: transport } as never,
      }),
    ).toBe("connected")
    expect(createRemoteView).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: agent.id, transport }),
    )
    expect(session.sessionId).toBe("sess-target")
  })

  it("joins http-attached agent without takeover prompt", async () => {
    listAgentsMock.mockResolvedValue([
      makeAgent({
        id: "00000000-0000-4000-8000-000000000007",
        attached: true,
        attachedVia: "http",
        acpSessionId: "sess-target",
      }),
    ])
    const session = makeSession()
    session.attachRemoteToLiveAgent.mockImplementation(async () => {
      session.status = "connected"
    })

    expect(
      await openSessionUrl({
        cliKind: "claude",
        sessionId: "sess-target",
        session: session as never,
        settings: { sessionTransport: "http" } as never,
      }),
    ).toBe("connected")
    expect(session.attachRemoteToLiveAgent).toHaveBeenCalled()
  })

  it("returns error when attach fails", async () => {
    listAgentsMock.mockResolvedValue([
      makeAgent({
        id: "00000000-0000-4000-8000-000000000006",
        acpSessionId: "sess-target",
      }),
    ])
    const session = makeSession()
    session.attachRemoteToLiveAgent.mockImplementation(async () => {
      session.status = "error"
      session.error = "reconnect failed"
    })

    expect(
      await openSessionUrl({
        cliKind: "claude",
        sessionId: "sess-target",
        session: session as never,
        settings: { sessionTransport: null } as never,
      }),
    ).toBe("error")
  })
})
