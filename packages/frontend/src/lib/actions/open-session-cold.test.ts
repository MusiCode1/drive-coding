/**
 * open-session-cold.test.ts — cold session URL path (slice fix-session-url-hijack C3).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createRemoteView } from "$lib/session/create-session-view"
import { MockSessionView } from "$lib/view-models/__fixtures__/mock-session-view.svelte"
import { AgentSession } from "$lib/view-models/agent-session.svelte"
import { openSessionCold } from "./open-session-cold.js"

vi.mock("$lib/adapters/agents-api", () => ({
  createAgent: vi.fn().mockResolvedValue({ agentId: "agent-1" }),
}))

const findSessionCwdMock =
  vi.fn<
    (cliKind: string, sessionId: string) => Promise<{ cwd: string; lastSeenAt: number } | null>
  >()

vi.mock("$lib/adapters/session-lookup", () => ({
  findSessionCwd: (cliKind: string, sessionId: string) => findSessionCwdMock(cliKind, sessionId),
}))

vi.mock("$env/dynamic/public", () => ({
  env: { PUBLIC_SESSION_TRANSPORT: undefined },
}))

type MockSession = {
  status: string
  sessionId: string | null
  error: string | null
  attachRemote: ReturnType<typeof vi.fn>
  switchSession: ReturnType<typeof vi.fn>
  detach: ReturnType<typeof vi.fn>
}

function makeSession(overrides: Partial<MockSession> = {}): MockSession {
  return {
    status: "idle",
    sessionId: null,
    error: null,
    attachRemote: vi.fn(async () => {}),
    switchSession: vi.fn(async () => {}),
    detach: vi.fn(),
    ...overrides,
  }
}

vi.mock("$lib/session/create-session-view")

const stores = new Map<string, string>()

beforeEach(() => {
  stores.clear()
  vi.mocked(createRemoteView).mockReset()
  findSessionCwdMock.mockReset()
  vi.stubGlobal("location", { search: "", protocol: "http:", host: "localhost" })
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

const settings = {
  sessionTransport: null,
  getProjectPrompt: () => "",
} as never

describe("openSessionCold", () => {
  it("returns not-found when cwd unknown", async () => {
    findSessionCwdMock.mockResolvedValue(null)
    const session = makeSession()
    expect(
      await openSessionCold({
        cliKind: "claude",
        sessionId: "s1",
        session: session as never,
        settings,
      }),
    ).toBe("not-found")
    expect(session.attachRemote).not.toHaveBeenCalled()
  })

  it.each(["ws", "http"] as const)(
    "%s: opens the view and loads the requested session",
    async (transport) => {
      findSessionCwdMock.mockResolvedValue({ cwd: "/p", lastSeenAt: 1 })
      const view = new MockSessionView()
      view.connect("fresh")
      view.loadSessionMock.mockImplementation(async (sessionId: string) => view.connect(sessionId))
      vi.mocked(createRemoteView).mockResolvedValue(
        view as unknown as Awaited<ReturnType<typeof createRemoteView>>,
      )
      const session = new AgentSession()

      expect(
        await openSessionCold({
          cliKind: "claude",
          sessionId: "s1",
          session,
          settings: { sessionTransport: transport, getProjectPrompt: () => "sys" } as never,
        }),
      ).toBe("connected")
      expect(createRemoteView).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: "agent-1", transport }),
      )
      expect(view.loadSessionMock).toHaveBeenCalledWith("s1", "/p")
      expect(session.sessionId).toBe("s1")
    },
  )

  it("HTTP: attach fails silently → error, no switch", async () => {
    findSessionCwdMock.mockResolvedValue({ cwd: "/p", lastSeenAt: 1 })
    const session = makeSession()
    session.attachRemote.mockImplementation(async () => {
      session.status = "error"
      session.error = "attach failed"
    })

    expect(
      await openSessionCold({
        cliKind: "claude",
        sessionId: "s1",
        session: session as never,
        settings: { sessionTransport: "http", getProjectPrompt: () => "" } as never,
      }),
    ).toBe("error")
    expect(session.switchSession).not.toHaveBeenCalled()
  })

  it("HTTP: attachRemote throws → error with session.error set", async () => {
    findSessionCwdMock.mockResolvedValue({ cwd: "/p", lastSeenAt: 1 })
    const session = makeSession()
    session.attachRemote.mockRejectedValue(new Error("network"))

    expect(
      await openSessionCold({
        cliKind: "claude",
        sessionId: "s1",
        session: session as never,
        settings: { sessionTransport: "http", getProjectPrompt: () => "" } as never,
      }),
    ).toBe("error")
    expect(session.error).toContain("network")
  })

  it("HTTP: switch leaves error → detach and preserve error", async () => {
    findSessionCwdMock.mockResolvedValue({ cwd: "/p", lastSeenAt: 1 })
    const session = makeSession()
    session.attachRemote.mockImplementation(async () => {
      session.status = "connected"
    })
    session.switchSession.mockImplementation(async () => {
      session.error = "switch failed"
    })

    expect(
      await openSessionCold({
        cliKind: "claude",
        sessionId: "s1",
        session: session as never,
        settings: { sessionTransport: "http", getProjectPrompt: () => "" } as never,
      }),
    ).toBe("error")
    expect(session.detach).toHaveBeenCalled()
    expect(session.error).toBe("switch failed")
  })

  it("HTTP: switchSession throws → detach and error", async () => {
    findSessionCwdMock.mockResolvedValue({ cwd: "/p", lastSeenAt: 1 })
    const session = makeSession()
    session.attachRemote.mockImplementation(async () => {
      session.status = "connected"
    })
    session.switchSession.mockRejectedValue(new Error("boom"))

    expect(
      await openSessionCold({
        cliKind: "claude",
        sessionId: "s1",
        session: session as never,
        settings: { sessionTransport: "http", getProjectPrompt: () => "" } as never,
      }),
    ).toBe("error")
    expect(session.detach).toHaveBeenCalled()
    expect(session.error).toBeTruthy()
  })

  it("findSessionCwd throws → error", async () => {
    findSessionCwdMock.mockRejectedValue(new Error("500"))
    const session = makeSession()
    expect(
      await openSessionCold({
        cliKind: "claude",
        sessionId: "s1",
        session: session as never,
        settings,
      }),
    ).toBe("error")
    expect(session.error).toBeTruthy()
  })
})
