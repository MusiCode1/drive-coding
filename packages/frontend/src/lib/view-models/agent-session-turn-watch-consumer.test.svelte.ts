/**
 * Facade → LocalTurnWatchOwner wiring (slice state-local-turn-watch-owner).
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import type { SessionNotification } from "@agentclientprotocol/sdk"
import { applyTurnStart } from "@drive-coding/core/session"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { STALL_HARD_CAP_MS, STALL_NOTICE_MS } from "$lib/engines/turn-watchdog"
import { MockSessionView } from "./__fixtures__/mock-session-view.svelte"
import { LocalTurnWatchOwner } from "./local-turn-watch-owner.svelte"

vi.mock("$lib/adapters/agents-api", () => ({
  createAgent: vi.fn().mockResolvedValue({ agentId: "tw-agent" }),
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  notifySessionAttached: vi.fn().mockResolvedValue(undefined),
  releaseConnection: vi.fn().mockResolvedValue(undefined),
  listAgents: vi.fn().mockResolvedValue([]),
}))

vi.mock("@drive-coding/acp-wire/browser", () => ({
  WsAcpTransport: vi.fn(function mockWsTransport() {
    return {
      onClose: vi.fn(),
      waitForOpen: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      closeAndWait: vi.fn().mockResolvedValue(undefined),
      sendRaw: vi.fn(),
    }
  }),
}))

vi.mock("$lib/adapters/ext", () => ({
  createExtClient: vi.fn(() => ({})),
}))

let capturedListener: ((n: SessionNotification) => void) | null = null

const mockClient = {
  prompt: vi.fn().mockResolvedValue(undefined),
  cancel: vi.fn().mockResolvedValue(undefined),
  newSession: vi.fn().mockResolvedValue({ sessionId: "s1" }),
  loadSession: vi.fn().mockResolvedValue({ sessionId: "s1" }),
  listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
  setSessionConfigOption: vi.fn(),
  setSessionModel: vi.fn(),
  setSessionMode: vi.fn(),
  close: vi.fn(),
}

vi.mock("@drive-coding/provider/client", async (importActual) => {
  const actual = await importActual<typeof import("@drive-coding/provider/client")>()
  return {
    ...actual,
    createAcpClient: vi
      .fn()
      .mockImplementation(
        (
          _transport: unknown,
          callbackOrCallbacks:
            | ((n: SessionNotification) => void)
            | { onUpdate: (n: SessionNotification) => void },
        ) => {
          capturedListener =
            typeof callbackOrCallbacks === "function"
              ? callbackOrCallbacks
              : callbackOrCallbacks.onUpdate
          return Promise.resolve(mockClient)
        },
      ),
  }
})

vi.stubGlobal("location", { protocol: "http:", host: "localhost:5173", search: "" })

import { AgentSession } from "./agent-session.svelte"

const vmPath = fileURLToPath(new URL("./agent-session.svelte.ts", import.meta.url))

function stubDocument(): void {
  vi.stubGlobal("document", { hidden: false, addEventListener: vi.fn() })
}

describe("AgentSession turnWatch consumer wiring", () => {
  beforeEach(() => {
    capturedListener = null
    vi.useFakeTimers()
    vi.setSystemTime(0)
    stubDocument()
    mockClient.cancel.mockClear()
    mockClient.prompt.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.stubGlobal("location", { protocol: "http:", host: "localhost:5173", search: "" })
  })

  it("HTTP #syncFromViewState notes activity (turnWatch.stalled clears)", () => {
    const view = new MockSessionView()
    view.connect("http-sess")
    const session = new AgentSession({ view })
    session._setStatusForTest("connected")
    const started = applyTurnStart(view.state)
    const turnStartPatch = started.patches[0]
    if (!turnStartPatch) throw new Error("expected turn-start patch")
    view.applyAndEmit(turnStartPatch)
    expect(session.turnState).toBe("waiting")
    vi.advanceTimersByTime(STALL_NOTICE_MS)
    vi.advanceTimersByTime(5_000)
    expect(session.turnWatch.stalled).toBe(true)
    view.fireUpdate({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "x" },
      messageId: "m1",
    })
    expect(session.turnWatch.stalled).toBe(false)
  })

  it("WS beforeUpdate notes activity via session/update", async () => {
    const session = new AgentSession()
    await session.attach({ cwd: "/tmp", cliKind: "claude" })
    void session.sendPrompt("hi")
    expect(session.turnState).toBe("waiting")
    vi.advanceTimersByTime(STALL_NOTICE_MS)
    vi.advanceTimersByTime(5_000)
    expect(session.turnWatch.stalled).toBe(true)
    if (!capturedListener) throw new Error("listener not captured")
    capturedListener({
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "chunk" },
        messageId: "m-ws",
      },
    } as SessionNotification)
    expect(session.turnWatch.stalled).toBe(false)
  })

  it("give-up syncs idle, clears turnWatch.stalled, never calls cancel", async () => {
    const session = new AgentSession()
    await session.attach({ cwd: "/tmp", cliKind: "claude" })
    void session.sendPrompt("hi")
    expect(session.turnState).toBe("waiting")
    vi.advanceTimersByTime(STALL_HARD_CAP_MS)
    vi.advanceTimersByTime(5_000)
    expect(session.turnState).toBe("idle")
    expect(session.turnWatch.stalled).toBe(false)
    vi.advanceTimersByTime(5_000)
    expect(session.turnState).toBe("idle")
    expect(session.turnWatch.stalled).toBe(false)
    expect(mockClient.cancel).not.toHaveBeenCalled()
  })

  it("#cleanup stops turn watch owner", () => {
    const stopSpy = vi.spyOn(LocalTurnWatchOwner.prototype, "stop")
    const session = new AgentSession()
    session.detach()
    expect(stopSpy).toHaveBeenCalled()
    stopSpy.mockRestore()
  })
})

describe("AgentSession turnWatch — mutation gate (#cleanup stop wiring)", () => {
  it("source pins #turnWatchOwner.stop inside #cleanup (manual delete breaks detach spy test)", () => {
    const src = readFileSync(vmPath, "utf8")
    expect(src).toMatch(/#cleanup[\s\S]*this\.#turnWatchOwner\.stop\(\)/)
  })
})
