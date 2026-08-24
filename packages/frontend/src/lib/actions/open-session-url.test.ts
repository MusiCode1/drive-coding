/**
 * open-session-url.test.ts — integration tests for session URL resolver (slice session-url C2).
 */

import type { AgentPublic } from "@drive-coding/core/schemas/agent"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SessionInfo } from "$lib/adapters/sessions"
import { openSessionUrl } from "./open-session-url.js"

const listAgentsMock = vi.fn<() => Promise<AgentPublic[]>>()

vi.mock("$lib/adapters/agents-api", () => ({
  listAgents: () => listAgentsMock(),
}))

vi.mock("$env/dynamic/public", () => ({
  env: { PUBLIC_SESSION_TRANSPORT: undefined },
}))

type MockSession = {
  status: string
  cliKind: string | null
  sessionId: string | null
  agentId: string | null
  error: string | null
  sessions: SessionInfo[]
  sessionsError: string | null
  listSessions: ReturnType<typeof vi.fn>
  switchSession: ReturnType<typeof vi.fn>
  attachToLiveAgent: ReturnType<typeof vi.fn>
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
  return {
    status: "idle",
    cliKind: null,
    sessionId: null,
    agentId: null,
    error: null,
    sessions: [],
    sessionsError: null,
    listSessions: vi.fn(async () => {}),
    switchSession: vi.fn(async () => {}),
    attachToLiveAgent: vi.fn(async () => {}),
    attachRemoteToLiveAgent: vi.fn(async () => {}),
    ...overrides,
  }
}

const stores = new Map<string, string>()

beforeEach(() => {
  stores.clear()
  listAgentsMock.mockReset()
  vi.stubGlobal("location", { search: "" })
  vi.stubGlobal("sessionStorage", {
    getItem: vi.fn((k: string) => stores.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => {
      stores.set(k, v)
    }),
  })
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

  it("switches session when connected to same cliKind", async () => {
    const session = makeSession({
      status: "connected",
      cliKind: "claude",
      sessionId: "other",
      sessions: [{ sessionId: "sess-b", cwd: "/proj", title: "B", updatedAt: "" }],
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
      sessionsError: "network down",
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
      sessions: [],
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
      sessions: [{ sessionId: "sess-b", cwd: "/proj", title: "", updatedAt: "" }],
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
      sessions: [{ sessionId: "sess-b", cwd: "/proj", title: "", updatedAt: "" }],
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

  it("returns not-found when no host agent exists", async () => {
    listAgentsMock.mockResolvedValue([])
    const session = makeSession()
    expect(
      await openSessionUrl({
        cliKind: "claude",
        sessionId: "sess-x",
        session: session as never,
        settings: { sessionTransport: null } as never,
      }),
    ).toBe("not-found")
  })

  it("returns not-found for warm pick before C4", async () => {
    listAgentsMock.mockResolvedValue([
      makeAgent({
        id: "00000000-0000-4000-8000-000000000001",
        acpSessionId: "other-session",
      }),
    ])
    const session = makeSession()
    expect(
      await openSessionUrl({
        cliKind: "claude",
        sessionId: "sess-target",
        session: session as never,
        settings: { sessionTransport: null } as never,
      }),
    ).toBe("not-found")
  })

  it("returns needs-takeover when agent attached and not owned by tab", async () => {
    listAgentsMock.mockResolvedValue([
      makeAgent({
        id: "00000000-0000-4000-8000-000000000002",
        attached: true,
        acpSessionId: "sess-target",
      }),
    ])
    const session = makeSession()
    expect(
      await openSessionUrl({
        cliKind: "claude",
        sessionId: "sess-target",
        session: session as never,
        settings: { sessionTransport: null } as never,
      }),
    ).toBe("needs-takeover")
  })

  it("skips takeover prompt when tab owns the agent", async () => {
    listAgentsMock.mockResolvedValue([
      makeAgent({
        id: "00000000-0000-4000-8000-000000000003",
        attached: true,
        acpSessionId: "sess-target",
      }),
    ])
    stores.set("dc.ownedAgentId", "00000000-0000-4000-8000-000000000003")
    const session = makeSession()
    session.attachToLiveAgent.mockImplementation(async () => {
      session.status = "connected"
      session.agentId = "00000000-0000-4000-8000-000000000003"
    })

    expect(
      await openSessionUrl({
        cliKind: "claude",
        sessionId: "sess-target",
        session: session as never,
        settings: { sessionTransport: null } as never,
      }),
    ).toBe("connected")
    expect(session.attachToLiveAgent).toHaveBeenCalled()
  })

  it("cold attach via ws on exact match", async () => {
    const agent = makeAgent({
      id: "00000000-0000-4000-8000-000000000004",
      acpSessionId: "sess-target",
    })
    listAgentsMock.mockResolvedValue([agent])
    const session = makeSession()
    session.attachToLiveAgent.mockImplementation(async () => {
      session.status = "connected"
    })

    expect(
      await openSessionUrl({
        cliKind: "claude",
        sessionId: "sess-target",
        session: session as never,
        settings: { sessionTransport: null } as never,
      }),
    ).toBe("connected")
    expect(session.attachToLiveAgent).toHaveBeenCalledWith({
      agentId: agent.id,
      sessionId: "sess-target",
      cwd: agent.cwd,
      cliKind: agent.cliKind,
    })
  })

  it("cold attach via http when transport is http", async () => {
    stores.set("sessionTransport", "http")
    const agent = makeAgent({
      id: "00000000-0000-4000-8000-000000000005",
      acpSessionId: "sess-target",
    })
    listAgentsMock.mockResolvedValue([agent])
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
    expect(session.attachToLiveAgent).not.toHaveBeenCalled()
  })

  it("returns error when attach fails", async () => {
    listAgentsMock.mockResolvedValue([
      makeAgent({
        id: "00000000-0000-4000-8000-000000000006",
        acpSessionId: "sess-target",
      }),
    ])
    const session = makeSession()
    session.attachToLiveAgent.mockImplementation(async () => {
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
