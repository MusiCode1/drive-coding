/**
 * live.test.svelte.ts — integration tests for Live VM wiring.
 *
 * Slice: live-secretary, Commit 0 — outgoing path + dispatch gate.
 * @vitest-environment jsdom
 */

import {
  formatAgentDelivery,
  LIVE_AGENT_DELIVERY_MARKER,
  LIVE_PERMISSION_PENDING_MARKER,
} from "@drive-coding/core/voice/live-prompt"
import type { LiveEvent } from "@drive-coding/core/voice/live-types"
import { flushSync } from "svelte"
import { describe, expect, it, vi, beforeEach } from "vitest"
import type { AgentSession } from "./agent-session.svelte"
import type { Mic } from "./mic.svelte"
import { Live } from "./live.svelte"

vi.mock("../adapters/voice/live-token", () => ({
  fetchLiveToken: vi.fn(async () => ({
    token: "tok",
    model: "m",
    sessionConfig: {},
    expiresAt: "2099",
  })),
}))

const sessionSend = vi.fn()
let providerOnEvent: ((event: LiveEvent) => void) | undefined
const providerSend = vi.fn()

vi.mock("../adapters/voice/live/gemini", () => ({
  geminiLive: {
    id: "gemini",
    inputSampleRate: 16_000,
    outputSampleRate: 24_000,
    supportsSilentContext: true,
    connect: vi.fn(async (opts: { onEvent: (event: LiveEvent) => void }) => {
      providerOnEvent = opts.onEvent
      return { send: providerSend, close: vi.fn() }
    }),
  },
}))

vi.mock("../engines/mic-frames", () => ({
  MicFrames: class {
    sampleRate = 16_000
    start = vi.fn(async () => {})
    stop = vi.fn(async () => {})
    on(_event: "frame", _h: (f: Float32Array) => void) {
      return () => {}
    }
    get level() {
      return 0
    }
  },
}))

beforeEach(() => {
  providerSend.mockClear()
  sessionSend.mockClear()
})

function mockMic(state: "idle" | "recording" | "transcribing" = "idle") {
  return { state } as unknown as Mic
}

function mockSession(overrides: Partial<AgentSession> = {}): AgentSession {
  const base = {
    status: "connected",
    sessionId: "ses_test",
    hasAcpClient: true,
    isRemoteView: false,
    turnState: "idle",
    pendingPermission: null,
    sendPrompt: vi.fn(async () => {}),
    recentAssistantMessages: vi.fn(() => []),
    resolvePermission: vi.fn(),
    ...overrides,
  }
  return base as unknown as AgentSession
}

function createLive(opts: { mic?: Mic; session: AgentSession }): { live: Live; dispose: () => void } {
  let live!: Live
  const dispose = $effect.root(() => {
    live = new Live({ mic: opts.mic ?? mockMic(), session: opts.session })
  })
  return { live, dispose }
}

async function openLive(session: AgentSession) {
  const { live, dispose } = createLive({ session })
  await live.toggle()
  expect(live.state).toBe("open")
  Object.defineProperty(live, "_testDispose", { value: dispose, writable: true })
  return live
}

describe("Live.canOpen", () => {
  it("false when mic is recording", () => {
    const { live, dispose } = createLive({ mic: mockMic("recording"), session: mockSession() })
    try {
      expect(live.canOpen).toBe(false)
    } finally {
      dispose()
    }
  })

  it("true when mic is idle and live closed", () => {
    const { live, dispose } = createLive({ session: mockSession() })
    try {
      expect(live.canOpen).toBe(true)
    } finally {
      dispose()
    }
  })
})

describe("Live outgoing path (Commit 0)", () => {
  it("compose_prompt calls sendPrompt and returns immediate action_result sent", async () => {
    const session = mockSession()
    await openLive(session)

    providerOnEvent?.({
      type: "action",
      id: "a1",
      name: "compose_prompt",
      args: { text: "fix auth.ts" },
    })

    expect(session.sendPrompt).toHaveBeenCalledWith("fix auth.ts")
    expect(providerSend).toHaveBeenCalledWith({
      type: "action_result",
      id: "a1",
      name: "compose_prompt",
      result: { status: "sent" },
    })
  })

  it("action_result sent immediately without waiting for agent turn", async () => {
    const session = mockSession({
      sendPrompt: vi.fn(() => new Promise(() => {})),
    })
    await openLive(session)

    providerOnEvent?.({
      type: "action",
      id: "a2",
      name: "compose_prompt",
      args: { text: "hello" },
    })

    expect(providerSend).toHaveBeenCalledWith(
      expect.objectContaining({ type: "action_result", result: { status: "sent" } }),
    )
  })

  it("not_sent when session not connected", async () => {
    const session = mockSession({ status: "idle" })
    await openLive(session)

    providerOnEvent?.({
      type: "action",
      id: "a3",
      name: "compose_prompt",
      args: { text: "hello" },
    })

    expect(session.sendPrompt).not.toHaveBeenCalled()
    expect(providerSend).toHaveBeenCalledWith({
      type: "action_result",
      id: "a3",
      name: "compose_prompt",
      result: { status: "not_sent", reason: "not-connected" },
    })
  })

  it("not_sent when local session lacks client", async () => {
    const session = mockSession({ hasAcpClient: false })
    await openLive(session)

    providerOnEvent?.({
      type: "action",
      id: "a4",
      name: "compose_prompt",
      args: { text: "hello" },
    })

    expect(providerSend).toHaveBeenCalledWith(
      expect.objectContaining({
        result: { status: "not_sent", reason: "no-session" },
      }),
    )
  })

  it("forward sends last final user transcript", async () => {
    const session = mockSession()
    const live = await openLive(session)

    live.transcript = [{ id: 0, role: "user", text: "raw ask", final: true }]
    providerOnEvent?.({
      type: "action",
      id: "a5",
      name: "forward",
      args: {},
    })

    expect(session.sendPrompt).toHaveBeenCalledWith("raw ask")
    expect(providerSend).toHaveBeenCalledWith(
      expect.objectContaining({ name: "forward", result: { status: "sent" } }),
    )
  })

  it("delivers agent answer via speakable context at turn boundary", async () => {
    const session = mockSession({
      recentAssistantMessages: vi.fn(() => ["The tests pass in auth.test.ts"]),
    })
    const live = await openLive(session)

    providerOnEvent?.({
      type: "action",
      id: "a6",
      name: "compose_prompt",
      args: { text: "run tests" },
    })

    live.deliverAgentAnswerIfPending()

    expect(providerSend).toHaveBeenCalledWith({
      type: "context",
      text: formatAgentDelivery("The tests pass in auth.test.ts"),
      channel: "speakable",
    })
    expect(providerSend.mock.calls.at(-1)?.[0]?.text).toContain(LIVE_AGENT_DELIVERY_MARKER)
  })

  it("$effect delivers marked agent answer when turnState becomes idle", async () => {
    const session = $state({
      status: "connected",
      sessionId: "ses_test",
      hasAcpClient: true,
      isRemoteView: false,
      turnState: "busy" as "idle" | "busy",
      pendingPermission: null,
      sendPrompt: vi.fn(async () => {}),
      recentAssistantMessages: vi.fn(() => ["Marked delivery auth.test.ts"]),
      resolvePermission: vi.fn(),
    })
    await openLive(session as unknown as AgentSession)

    providerOnEvent?.({
      type: "action",
      id: "a6b",
      name: "compose_prompt",
      args: { text: "run tests" },
    })

    session.turnState = "idle"
    flushSync()

    expect(providerSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "context",
        channel: "speakable",
        text: formatAgentDelivery("Marked delivery auth.test.ts"),
      }),
    )
  })

  it("notifies pending permission via marked speakable context", async () => {
    const session = $state({
      status: "connected",
      sessionId: "ses_test",
      hasAcpClient: true,
      isRemoteView: false,
      turnState: "idle" as const,
      pendingPermission: null as {
        requestId: number
        params: {
          options: { optionId: string; name: string; kind: string }[]
          toolCall: { toolCallId: string; title: string }
        }
        resolve: (r: unknown) => void
      } | null,
      sendPrompt: vi.fn(async () => {}),
      recentAssistantMessages: vi.fn(() => []),
      resolvePermission: vi.fn(),
    })
    await openLive(session as unknown as AgentSession)
    session.pendingPermission = {
      requestId: 42,
      params: {
        options: [
          { optionId: "allow-1", name: "Allow once", kind: "allow_once" },
          { optionId: "deny-1", name: "Deny", kind: "reject_once" },
        ],
        toolCall: { toolCallId: "t1", title: "Run command" },
      },
      resolve: vi.fn(),
    }
    flushSync()

    expect(providerSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "context",
        channel: "speakable",
        text: expect.stringContaining(LIVE_PERMISSION_PENDING_MARKER),
      }),
    )
    expect(providerSend.mock.calls.at(-1)?.[0]?.text).toContain("allow-1: Allow once")
  })

  it("answer_permission rejects optionId outside the closed list", async () => {
    const session = mockSession({
      pendingPermission: {
        params: {
          options: [{ optionId: "allow-1", name: "Allow once", kind: "allow_once" }],
          toolCall: { toolCallId: "t1", title: "Run command" },
        },
        resolve: vi.fn(),
      },
    })
    await openLive(session)

    providerOnEvent?.({
      type: "action",
      id: "a8",
      name: "answer_permission",
      args: { optionId: "wrong-id" },
    })

    expect(session.resolvePermission).not.toHaveBeenCalled()
    expect(providerSend).toHaveBeenCalledWith({
      type: "action_result",
      id: "a8",
      name: "answer_permission",
      result: { status: "not_sent", reason: "invalid-option" },
    })
  })

  it("answer_permission resolves pending permission and returns sent", async () => {
    const resolvePermission = vi.fn()
    const session = mockSession({
      pendingPermission: {
        params: {
          options: [
            { optionId: "allow-1", name: "Allow once", kind: "allow_once" },
            { optionId: "deny-1", name: "Deny", kind: "reject_once" },
          ],
          toolCall: { toolCallId: "t1", title: "Run command" },
        },
        resolve: vi.fn(),
      },
      resolvePermission,
    })
    await openLive(session)

    providerOnEvent?.({
      type: "action",
      id: "a7",
      name: "answer_permission",
      args: { optionId: "allow-1" },
    })

    expect(resolvePermission).toHaveBeenCalledWith("allow-1")
    expect(providerSend).toHaveBeenCalledWith({
      type: "action_result",
      id: "a7",
      name: "answer_permission",
      result: { status: "sent" },
    })
  })
})
