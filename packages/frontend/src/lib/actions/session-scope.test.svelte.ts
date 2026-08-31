/**
 * session-scope.test.svelte.ts — S1 session-scope-core gates G1–G7.
 *
 * Harness mirrors +layout wiring via bindSessionScope (see session-scope.ts from Commit 2).
 * G2/G4 local switch/new/delete paths require attach() — agent-session.local-view harness.
 */

import { OrderAllocator } from "@drive-coding/core/voice/tts-queue"
import type { OrderKey } from "@drive-coding/core/voice/tts-queue"
import type { AcpClient, AcpClientCallbacks } from "@drive-coding/provider/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AudioPlaylist } from "$lib/engines/audio-playlist.svelte"
import type { AudioSink } from "$lib/engines/audio-sink"
import type { ViewEmission } from "$lib/session/session-view"
import { MockSessionView } from "$lib/view-models/__fixtures__/mock-session-view.svelte"
import { AgentSession, type SessionEndReason } from "$lib/view-models/agent-session.svelte"
import { Settings } from "$lib/view-models/settings.svelte"
import { Speaker } from "$lib/view-models/speaker.svelte"
import { bindSessionScope } from "./session-scope"

vi.mock("$lib/adapters/voice/tts-resolve", () => ({
  resolveTts: vi.fn(() => ({
    provider: { format: "pcm" as const, synthesize: vi.fn() },
    voiceId: "v",
    modelId: "m",
  })),
}))
vi.mock("$lib/adapters/voice/translate", () => ({ translate: vi.fn() }))
vi.mock("$lib/adapters/voice/narrate", () => ({ narrate: vi.fn() }))

function makeMockSink() {
  const prepared = new Set<string>()
  const sink = {
    prepareSegment: vi.fn(async (id: string) => {
      prepared.add(id)
    }),
    play: vi.fn(() => new Promise<void>(() => {})),
    cancel: vi.fn(),
    clear: vi.fn(() => prepared.clear()),
    pause: vi.fn(),
    resume: vi.fn(),
    isComplete: () => false,
  }
  return sink as unknown as AudioSink & typeof sink
}

const key = (seq: number): OrderKey => ({ seq, segmentIndex: 0 })

function audioHarness() {
  const settings = new Settings()
  const session = new AgentSession({ settings })
  const sink = makeMockSink()
  const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })
  const orderAlloc = new OrderAllocator()
  const speaker = new Speaker({
    session,
    settings,
    playlist,
    audioStream: sink,
    orderAlloc,
  })
  bindSessionScope({ session, speaker, orderAlloc })
  return { session, sink, playlist, orderAlloc, speaker }
}

function reasonHarness() {
  const session = new AgentSession()
  const reasons: SessionEndReason[] = []
  session.onSessionEnd((r) => reasons.push(r))
  return { session, reasons }
}

// ─── Local-view mocks (G2/G4 — attach() required) ───────────────────────────

type TransportFn = ReturnType<typeof vi.fn>

const lv = vi.hoisted(() => {
  const rawClient = {
    newSession: vi.fn().mockResolvedValue({ sessionId: "sess-new" }),
    loadSession: vi.fn().mockResolvedValue({ sessionId: "sess-load" }),
    prompt: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    extMethod: vi.fn().mockResolvedValue({ snapshot: null }),
    listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    setSessionConfigOption: vi.fn().mockResolvedValue({ configOptions: [] }),
    setSessionMode: vi.fn().mockResolvedValue(undefined),
    setSessionModel: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    conn: {},
    capabilities: { promptCapabilities: {}, sessionCapabilities: { delete: true } },
    authMethods: [{ id: "apiKey", name: "API Key" }],
  }
  const client = rawClient as unknown as AcpClient
  const state = {
    client,
    teedCallbacks: null as (AcpClientCallbacks & { onUpdate: TransportFn }) | null,
    transports: [] as Array<{ close: TransportFn; closeAndWait: TransportFn; waitForOpen: TransportFn }>,
    queue: [] as Array<{ mode: "open" }>,
  }
  return { state }
})

vi.mock("@drive-coding/acp-wire/browser", () => ({
  WsAcpTransport: vi.fn(function MockTransport() {
    const t = {
      onClose: vi.fn(),
      waitForOpen: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      closeAndWait: vi.fn().mockResolvedValue(undefined),
    }
    lv.state.transports.push(t)
    return t
  }),
}))

vi.mock("@drive-coding/provider/client", async (importActual) => {
  const actual = await importActual<typeof import("@drive-coding/provider/client")>()
  return {
    ...actual,
    createAcpClient: vi.fn(function mockCreateClient(_transport: unknown, callbacks: unknown) {
      lv.state.teedCallbacks = callbacks as (typeof lv.state)["teedCallbacks"]
      return Promise.resolve(lv.state.client)
    }),
    createAttachedAcpClient: vi.fn(function mockAttachedClient(_transport: unknown, callbacks: unknown) {
      lv.state.teedCallbacks = callbacks as (typeof lv.state)["teedCallbacks"]
      return lv.state.client
    }),
  }
})

vi.mock("$lib/adapters/agents-api", () => ({
  createAgent: vi.fn().mockResolvedValue({ agentId: "test-agent" }),
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  notifySessionAttached: vi.fn().mockResolvedValue(undefined),
  listAgents: vi.fn().mockResolvedValue([]),
}))

vi.mock("$lib/adapters/sessions", () => ({
  normalizeSessionInfo: vi.fn((x: unknown) => x),
}))

vi.mock("$lib/session/local-session-view", async (importActual) => {
  const actual = await importActual<typeof import("$lib/session/local-session-view")>()
  return {
    ...actual,
    LocalSessionView: class CapturedLocalSessionView extends actual.LocalSessionView {
      static instances: CapturedLocalSessionView[] = []
      constructor(opts: ConstructorParameters<typeof actual.LocalSessionView>[0]) {
        super(opts)
        CapturedLocalSessionView.instances.push(this)
      }
    },
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  lv.state.teedCallbacks = null
  lv.state.transports = []
  vi.stubGlobal("location", { protocol: "http:", host: "localhost:4000" })
  vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("test-uuid") })
})

// ─── Commit 0 — G1–G3 (red on base) ──────────────────────────────────────────

describe("session-scope G1 — detach clears playlist and sink", () => {
  it("detach() empties playlist and calls sink.clear", () => {
    const { session, sink, playlist } = audioHarness()
    playlist.reserve("seg-1", key(0), "bubble-1")
    playlist.markReady("seg-1")
    expect(playlist.items.length).toBe(1)

    session.detach()

    expect(playlist.items.length).toBe(0)
    expect(sink.clear).toHaveBeenCalled()
  })
})

describe("session-scope G2 — switchSession clears previous session audio", () => {
  it("switchSession() does not leave items from the previous session", async () => {
    const { session, playlist } = audioHarness()
    await session.attach({ cwd: "/tmp", cliKind: "opencode" })
    playlist.reserve("seg-a", key(0), "bubble-a")
    playlist.markReady("seg-a")
    expect(playlist.items.length).toBe(1)

    await session.switchSession({ sessionId: "sess-b", cwd: "/tmp", cliKind: "opencode" })

    expect(playlist.items.length).toBe(0)
  })
})

describe("session-scope G3 — leaveRunning clears audio", () => {
  it("leaveRunning() empties playlist and calls sink.clear", async () => {
    const { session, sink, playlist } = audioHarness()
    playlist.reserve("seg-1", key(0), "bubble-1")
    playlist.markReady("seg-1")
    expect(playlist.items.length).toBe(1)

    await session.leaveRunning()

    expect(playlist.items.length).toBe(0)
    expect(sink.clear).toHaveBeenCalled()
  })
})

// ─── Commit 3 — G4–G7 enforcement gates ─────────────────────────────────────

describe("session-scope G4 — every exit path fires onSessionEnd with correct reason", () => {
  it("detach → detach", () => {
    const { session, reasons } = reasonHarness()
    session.detach()
    expect(reasons).toEqual(["detach"])
  })

  it("leaveRunning → leave-running", async () => {
    const { session, reasons } = reasonHarness()
    await session.leaveRunning()
    expect(reasons).toEqual(["leave-running"])
  })

  it("loadSession → load", async () => {
    const { session, reasons } = reasonHarness()
    await session.loadSession({ sessionId: "sess-1", cwd: "/tmp", cliKind: "opencode" })
    expect(reasons).toEqual(["load"])
  })

  it("switchSession local (after attach) → switch", async () => {
    const { session, reasons } = reasonHarness()
    await session.attach({ cwd: "/tmp", cliKind: "opencode" })
    reasons.length = 0
    await session.switchSession({ sessionId: "sess-b", cwd: "/tmp", cliKind: "opencode" })
    expect(reasons).toEqual(["switch"])
  })

  it("newSession local warm (after attach) → new", async () => {
    const { session, reasons } = reasonHarness()
    await session.attach({ cwd: "/tmp", cliKind: "opencode" })
    reasons.length = 0
    await session.newSession({ cliKind: "opencode" })
    expect(reasons).toEqual(["new"])
  })

  it("newSession local fallback (no #client) → new before attach", async () => {
    const { session, reasons } = reasonHarness()
    await session.newSession({ cwd: "/tmp", cliKind: "opencode" })
    expect(reasons[0]).toBe("new")
  })

  it("deleteSession local active → delete", async () => {
    const { session, reasons } = reasonHarness()
    await session.attach({ cwd: "/tmp", cliKind: "opencode" })
    const sid = session.sessionId
    if (!sid) throw new Error("expected sessionId after attach")
    reasons.length = 0
    await session.deleteSession(sid)
    expect(reasons).toEqual(["delete"])
  })

  it("switchSession remote → switch", async () => {
    const view = new MockSessionView()
    view.connect("remote-sess-1")
    const session = new AgentSession({ view })
    session._setStatusForTest("connected")
    const reasons: SessionEndReason[] = []
    session.onSessionEnd((r) => reasons.push(r))
    await session.switchSession({ sessionId: "remote-sess-2", cwd: "/tmp", cliKind: "opencode" })
    expect(reasons).toEqual(["switch"])
  })

  it("deleteSession remote active → delete", async () => {
    const view = new MockSessionView()
    view.connect("remote-sess-1")
    const session = new AgentSession({ view })
    session._setStatusForTest("connected")
    session._setSessionContextForTest({
      sessionId: "remote-sess-1",
      cwd: "/tmp",
      cliKind: "opencode",
    })
    const reasons: SessionEndReason[] = []
    session.onSessionEnd((r) => reasons.push(r))
    await session.deleteSession("remote-sess-1")
    expect(reasons).toEqual(["delete"])
  })
})

describe("session-scope G5 — bindSessionScope calls stop() before clear()", () => {
  it("stop precedes clear on session end", () => {
    const order: string[] = []
    const stop = vi.fn(() => order.push("stop"))
    const clear = vi.fn(() => order.push("clear"))
    bindSessionScope({
      session: {
        onSessionEnd: (cb) => {
          cb("detach")
          return () => {}
        },
      },
      speaker: { stop },
      orderAlloc: { clear },
    })
    expect(order).toEqual(["stop", "clear"])
  })
})

describe("session-scope G6 — double session-end is idempotent", () => {
  it("two consecutive listener invocations do not throw", () => {
    const { session, sink, playlist, orderAlloc, speaker } = audioHarness()
    playlist.reserve("seg-1", key(0), "bubble-1")
    playlist.markReady("seg-1")
    let listener: ((reason: SessionEndReason) => void) | undefined
    bindSessionScope({
      session: {
        onSessionEnd: (cb) => {
          listener = cb
          return () => {}
        },
      },
      speaker,
      orderAlloc,
    })
    expect(() => {
      listener!("detach")
      listener!("detach")
    }).not.toThrow()
    expect(playlist.items.length).toBe(0)
    expect(sink.clear).toHaveBeenCalled()
  })
})

describe("session-scope G7 — loadSession preserveContextOnError does not fire", () => {
  it("cold-reconnect preserve path skips session-end", async () => {
    const { session, reasons } = reasonHarness()
    await session.loadSession(
      { sessionId: "sess-1", cwd: "/tmp", cliKind: "opencode" },
      { preserveContextOnError: true },
    )
    expect(reasons).not.toContain("load")
  })
})
