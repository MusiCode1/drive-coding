/**
 * live.test.svelte.ts — integration tests for Live VM wiring.
 *
 * Slice: live-secretary, Commit 0 — outgoing path + dispatch gate.
 */

import type { LiveEvent } from "@drive-coding/core/voice/live-types"
import { describe, expect, it, vi } from "vitest"
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

function mockMic(state: "idle" | "recording" | "transcribing" = "idle") {
  return { state } as unknown as Mic
}

function mockSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    status: "connected",
    sessionId: "ses_test",
    hasAcpClient: true,
    isRemoteView: false,
    turnState: "idle",
    sendPrompt: vi.fn(async () => {}),
    recentAssistantMessages: vi.fn(() => []),
    ...overrides,
  } as unknown as AgentSession
}

async function openLive(session: AgentSession) {
  const live = new Live({ mic: mockMic(), session })
  await live.toggle()
  expect(live.state).toBe("open")
  return live
}

describe("Live.canOpen", () => {
  it("false when mic is recording", () => {
    const live = new Live({ mic: mockMic("recording"), session: mockSession() })
    expect(live.canOpen).toBe(false)
  })

  it("true when mic is idle and live closed", () => {
    const live = new Live({ mic: mockMic("idle"), session: mockSession() })
    expect(live.canOpen).toBe(true)
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
      text: "The tests pass in auth.test.ts",
      channel: "speakable",
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
