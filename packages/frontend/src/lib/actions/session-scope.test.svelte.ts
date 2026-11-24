/**
 * session-scope.test.svelte.ts — S1 session-scope-core gates G1–G7.
 *
 * Harness mirrors +layout wiring via bindSessionScope (see session-scope.ts from Commit 2).
 * G2/G4 use the AgentSession entry points backed by an injected session view.
 */

import type { OrderKey } from "@drive-coding/core/voice/tts-queue"
import { OrderAllocator } from "@drive-coding/core/voice/tts-queue"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AudioPlaylist } from "$lib/engines/audio-playlist.svelte"
import type { AudioSink } from "$lib/engines/audio-sink"
import { createRemoteView } from "$lib/session/create-session-view"
import { MockSessionView } from "$lib/view-models/__fixtures__/mock-session-view.svelte"
import { AgentSession, type SessionEndReason } from "$lib/view-models/agent-session.svelte"
import { Settings } from "$lib/view-models/settings.svelte"
import { Speaker } from "$lib/view-models/speaker.svelte"
import { bindSessionScope } from "./session-scope"

// Keep the module's real exports (settings-persistence imports its default model ids) and
// replace only resolveTts — a factory with resolveTts alone crashed the import chain.
vi.mock("$lib/adapters/voice/tts-resolve", async (importOriginal) => ({
  ...(await importOriginal<typeof import("$lib/adapters/voice/tts-resolve")>()),
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

vi.mock("$lib/session/create-session-view")
vi.mock("$lib/adapters/agents-api", () => ({
  createAgent: vi.fn().mockResolvedValue({ agentId: "test-agent" }),
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  notifySessionAttached: vi.fn().mockResolvedValue(undefined),
}))

beforeEach(() => {
  vi.clearAllMocks()
  const view = new MockSessionView()
  view.connect("sess-initial")
  vi.mocked(createRemoteView).mockResolvedValue(
    view as unknown as Awaited<ReturnType<typeof createRemoteView>>,
  )
  vi.stubGlobal("location", { protocol: "http:", host: "localhost:4000" })
})

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
    await session.attachRemote({ cwd: "/project", cliKind: "opencode", transport: "ws" })
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

  it("openMockSession → load", async () => {
    const { session, reasons } = reasonHarness()
    await session.openMockSession("unused-fixture", "/project")
    expect(reasons).toEqual(["load"])
  })

  it("switchSession on a WebSocket view → switch", async () => {
    const { session, reasons } = reasonHarness()
    await session.attachRemote({ cwd: "/project", cliKind: "opencode", transport: "ws" })
    reasons.length = 0
    await session.switchSession({ sessionId: "sess-b", cwd: "/tmp", cliKind: "opencode" })
    expect(reasons).toEqual(["switch"])
  })

  it("newSession on a connected WebSocket view → new", async () => {
    const { session, reasons } = reasonHarness()
    await session.attachRemote({ cwd: "/project", cliKind: "opencode", transport: "ws" })
    reasons.length = 0
    await session.newSession({ cliKind: "opencode" })
    expect(reasons).toEqual(["new"])
  })

  it("newSession without an existing view → new before attach", async () => {
    const { session, reasons } = reasonHarness()
    await session.newSession({ cwd: "/tmp", cliKind: "opencode" })
    expect(reasons[0]).toBe("new")
  })

  it("deleteSession on the active WebSocket view → delete", async () => {
    const { session, reasons } = reasonHarness()
    await session.attachRemote({ cwd: "/project", cliKind: "opencode", transport: "ws" })
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

// ─── Commit 0 — N2/N3/N5 session-scope-nav gates (red on base) ───────────────

describe("session-scope-nav N2 — notifySessionNavigatedAway clears audio when connected", () => {
  it("after audioHarness + connected status, notify clears playlist and sink", () => {
    const { session, sink, playlist } = audioHarness()
    playlist.reserve("seg-1", key(0), "bubble-1")
    playlist.markReady("seg-1")
    expect(playlist.items.length).toBe(1)
    session._setStatusForTest("connected")

    session.notifySessionNavigatedAway()

    expect(playlist.items.length).toBe(0)
    expect(sink.clear).toHaveBeenCalled()
  })
})

describe("session-scope-nav N3 — notifySessionNavigatedAway no-op when idle", () => {
  it("idle session does not fire onSessionEnd with navigate", () => {
    const { session, reasons } = reasonHarness()
    session.notifySessionNavigatedAway()
    expect(reasons).not.toContain("navigate")
  })
})

describe("session-scope-nav N5 — double session-end after leaveRunning is idempotent", () => {
  it("leaveRunning then notifySessionNavigatedAway does not throw and clears queue", async () => {
    const { session, sink, playlist } = audioHarness()
    playlist.reserve("seg-1", key(0), "bubble-1")
    playlist.markReady("seg-1")
    session._setStatusForTest("connected")

    await session.leaveRunning()
    expect(() => session.notifySessionNavigatedAway()).not.toThrow()
    expect(playlist.items.length).toBe(0)
    expect(sink.clear).toHaveBeenCalled()
  })
})
