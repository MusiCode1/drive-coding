/**
 * resume-session.test.ts — the cold path: no live host, resume from the history row.
 *
 * `openSessionUrl` is used for real here rather than mocked, with `listAgents` empty, so
 * these tests exercise the actual hand-off from "no live host" to the cold spawn. The
 * negative cases matter most: a missing row must not spawn anything.
 */

import type { AgentPublic } from "@drive-coding/core/schemas/agent"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SessionHistoryRow } from "$lib/adapters/session-history-api"
import { resumeSession } from "./resume-session.js"

const listAgentsMock = vi.fn<() => Promise<AgentPublic[]>>()
const fetchRowMock = vi.fn<() => Promise<SessionHistoryRow | undefined>>()

vi.mock("$lib/adapters/agents-api", () => ({
  listAgents: () => listAgentsMock(),
}))

vi.mock("$lib/adapters/session-history-api", () => ({
  fetchSessionHistoryRow: () => fetchRowMock(),
}))

vi.mock("$env/dynamic/public", () => ({
  env: { PUBLIC_SESSION_TRANSPORT: undefined },
}))

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    status: "idle",
    cliKind: null,
    sessionId: null,
    agentId: null,
    error: null,
    sessionsCache: { sessions: [], error: null },
    listSessions: vi.fn(async () => {}),
    switchSession: vi.fn(async () => {}),
    attach: vi.fn(async () => {}),
    attachRemote: vi.fn(async () => {}),
    attachToLiveAgent: vi.fn(async () => {}),
    attachRemoteToLiveAgent: vi.fn(async () => {}),
    ...overrides,
  }
}

function makeSettings() {
  return {
    sessionTransport: null,
    setCliKind: vi.fn(),
    setLastCwd: vi.fn(),
    getProjectPrompt: vi.fn(() => null),
  }
}

const stores = new Map<string, string>()

beforeEach(() => {
  stores.clear()
  listAgentsMock.mockReset()
  fetchRowMock.mockReset()
  listAgentsMock.mockResolvedValue([])
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

describe("resumeSession — cold path", () => {
  it("spawns on the row's cwd and loads the asked-for session", async () => {
    fetchRowMock.mockResolvedValue({
      cliKind: "claude",
      acpSessionId: "sess-old",
      cwd: "/home/u/proj",
      lastSeenAt: 1,
      turns: 3,
    })
    const session = makeSession({ status: "idle" })
    // attach is what brings the host up; from then on the VM reports connected.
    session.attach = vi.fn(async () => {
      session.status = "connected"
    })

    const outcome = await resumeSession({
      cliKind: "claude",
      sessionId: "sess-old",
      session: session as never,
      settings: makeSettings() as never,
    })

    expect(outcome).toBe("connected")
    expect(session.attach).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "/home/u/proj", cliKind: "claude" }),
    )
    expect(session.switchSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "sess-old", cwd: "/home/u/proj" }),
    )
  })

  it("no row and no ?cwd= → not-in-history, and nothing is spawned", async () => {
    fetchRowMock.mockResolvedValue(undefined)
    const session = makeSession({ status: "idle" })

    const outcome = await resumeSession({
      cliKind: "claude",
      sessionId: "sess-unknown",
      session: session as never,
      settings: makeSettings() as never,
    })

    expect(outcome).toBe("not-in-history")
    expect(session.attach).not.toHaveBeenCalled()
    expect(session.attachRemote).not.toHaveBeenCalled()
    expect(session.switchSession).not.toHaveBeenCalled()
  })

  it("?cwd= wins and skips the lookup — a session we never hosted has no row", async () => {
    const session = makeSession({ status: "idle" })
    session.attach = vi.fn(async () => {
      session.status = "connected"
    })

    const outcome = await resumeSession({
      cliKind: "claude",
      sessionId: "sess-foreign",
      cwdOverride: "/from/link",
      session: session as never,
      settings: makeSettings() as never,
    })

    expect(outcome).toBe("connected")
    expect(fetchRowMock).not.toHaveBeenCalled()
    expect(session.attach).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/from/link" }))
  })

  it("a row naming a session the CLI has dropped surfaces as error, not connected", async () => {
    fetchRowMock.mockResolvedValue({
      cliKind: "claude",
      acpSessionId: "sess-gone",
      cwd: "/home/u/proj",
      lastSeenAt: 1,
      turns: 0,
    })
    const session = makeSession({ status: "idle" })
    session.attach = vi.fn(async () => {
      session.status = "connected"
    })
    session.switchSession = vi.fn(async () => {
      throw new Error("session/load failed")
    })

    const outcome = await resumeSession({
      cliKind: "claude",
      sessionId: "sess-gone",
      session: session as never,
      settings: makeSettings() as never,
    })

    expect(outcome).toBe("error")
  })

  it("a failed lookup is error, not not-in-history — the two must stay distinct", async () => {
    fetchRowMock.mockRejectedValue(new Error("boom"))
    const session = makeSession({ status: "idle" })

    const outcome = await resumeSession({
      cliKind: "claude",
      sessionId: "sess-x",
      session: session as never,
      settings: makeSettings() as never,
    })

    expect(outcome).toBe("error")
    expect(session.attach).not.toHaveBeenCalled()
  })
})

describe("resumeSession — live host first", () => {
  it("already on that session → connected without a lookup or a spawn", async () => {
    const session = makeSession({ status: "connected", sessionId: "sess-a", cliKind: "claude" })

    const outcome = await resumeSession({
      cliKind: "claude",
      sessionId: "sess-a",
      session: session as never,
      settings: makeSettings() as never,
    })

    expect(outcome).toBe("connected")
    expect(fetchRowMock).not.toHaveBeenCalled()
    expect(session.attach).not.toHaveBeenCalled()
  })

  it("a live agent holding it under another tab asks for takeover, never a second host", async () => {
    listAgentsMock.mockResolvedValue([
      {
        id: "agent-1",
        cliKind: "claude",
        cwd: "/tmp",
        modelOverride: null,
        status: "ready",
        createdAt: "2026-01-01T00:00:00.000Z",
        acpSessionId: "sess-a",
        attached: true,
        attachedVia: "ws",
      } as AgentPublic,
    ])
    const session = makeSession({ status: "idle" })

    const outcome = await resumeSession({
      cliKind: "claude",
      sessionId: "sess-a",
      session: session as never,
      settings: makeSettings() as never,
    })

    expect(outcome).toBe("needs-takeover")
    expect(session.attach).not.toHaveBeenCalled()
    expect(fetchRowMock).not.toHaveBeenCalled()
  })
})
