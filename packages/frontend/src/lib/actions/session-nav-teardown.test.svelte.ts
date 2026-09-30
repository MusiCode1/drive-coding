/**
 * attach-status-gate BCE — navigation teardown gates (bugs #52 / #72).
 * Harness: real AgentSession + bindSessionScope + onSessionRouteChange.
 */

import { OrderAllocator } from "@drive-coding/core/voice/tts-queue"
import { describe, expect, it, vi } from "vitest"
import { AudioPlaylist } from "$lib/engines/audio-playlist.svelte"
import type { AudioSink } from "$lib/engines/audio-sink"
import { AgentSession } from "$lib/view-models/agent-session.svelte"
import { Settings } from "$lib/view-models/settings.svelte"
import { Speaker } from "$lib/view-models/speaker.svelte"
import { bindSessionScope } from "./session-scope"
import { onSessionRouteChange } from "./session-scope-nav"

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

function harness() {
  const settings = new Settings()
  const session = new AgentSession({ settings })
  const sink = makeMockSink()
  const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })
  const orderAlloc = new OrderAllocator()
  const speaker = new Speaker({ session, settings, playlist, audioStream: sink, orderAlloc })
  bindSessionScope({ session, speaker, orderAlloc })
  return { session, sink, playlist }
}

describe("session-nav teardown gates", () => {
  it("gate 1: status !== connected after /chat → /", () => {
    const { session } = harness()
    session._setStatusForTest("connected")
    onSessionRouteChange("/chat", "/", session)
    expect(session.status).not.toBe("connected")
  })

  it("gate 2: agentId === null after /chat → /", () => {
    const { session } = harness()
    session._setStatusForTest("connected")
    session.agentId = "agent-test-1"
    onSessionRouteChange("/chat", "/", session)
    expect(session.agentId).toBeNull()
  })

  it("gate 3: attach() after navigate-away does not reject with cannot attach", async () => {
    const { session } = harness()
    session._setStatusForTest("connected")
    onSessionRouteChange("/chat", "/", session)

    let thrown: unknown
    await session.attach({ cwd: "/tmp", cliKind: "claude" }).catch((e) => {
      thrown = e
    })
    expect(String(thrown ?? "")).not.toContain("cannot attach in status connected")
  })

  it("gate 4 negative: /chat → /settings does not change status or agentId", () => {
    const { session } = harness()
    session._setStatusForTest("connected")
    session.agentId = "agent-test-1"
    onSessionRouteChange("/chat", "/settings", session)
    expect(session.status).toBe("connected")
    expect(session.agentId).toBe("agent-test-1")
  })

  it("gate 4b negative: /settings → /usage does not reset", () => {
    const { session } = harness()
    session._setStatusForTest("connected")
    session.agentId = "agent-test-1"
    onSessionRouteChange("/settings", "/usage", session)
    expect(session.status).toBe("connected")
    expect(session.agentId).toBe("agent-test-1")
  })

  it("gate 4g negative: /chat → /some-future-route does not reset", () => {
    const { session } = harness()
    session._setStatusForTest("connected")
    session.agentId = "agent-test-1"
    onSessionRouteChange("/chat", "/some-future-route", session)
    expect(session.status).toBe("connected")
    expect(session.agentId).toBe("agent-test-1")
  })

  it("gate 4d negative: empty from does not reset", () => {
    const { session } = harness()
    session._setStatusForTest("connected")
    session.agentId = "agent-test-1"
    onSessionRouteChange("", "/", session)
    expect(session.status).toBe("connected")
    expect(session.agentId).toBe("agent-test-1")
  })

  it("gate 4v negative: unlisted from /some-unlisted-path → / does not reset", () => {
    const { session } = harness()
    session._setStatusForTest("connected")
    session.agentId = "agent-test-1"
    onSessionRouteChange("/some-unlisted-path", "/", session)
    expect(session.status).toBe("connected")
    expect(session.agentId).toBe("agent-test-1")
  })

  it("gate 4z positive: /chat/ → / resets", () => {
    const { session } = harness()
    session._setStatusForTest("connected")
    session.agentId = "agent-test-1"
    onSessionRouteChange("/chat/", "/", session)
    expect(session.status).not.toBe("connected")
    expect(session.agentId).toBeNull()
  })

  it("gate 4h positive: /chat → /bt-test resets", () => {
    const { session } = harness()
    session._setStatusForTest("connected")
    session.agentId = "agent-test-1"
    onSessionRouteChange("/chat", "/bt-test", session)
    expect(session.status).not.toBe("connected")
    expect(session.agentId).toBeNull()
  })

  it("gate 7: detach() with pendingPermission is idle in the same tick", () => {
    const { session } = harness()
    session._setStatusForTest("connected")
    session.pendingPermission = {
      params: {
        sessionId: "sess-gate-7",
        options: [{ optionId: "allow-1", name: "Allow", kind: "allow_once" }],
        toolCall: { toolCallId: "tc-1", title: "test" },
      },
      resolve: () => {},
    }

    session.detach()
    expect(session.status).toBe("idle")
  })
})
