/**
 * live.test.svelte.ts — integration tests for Live VM wiring.
 *
 * Slice: live-secretary, Commit 0 — outgoing path + dispatch gate.
 * @vitest-environment jsdom
 */

import {
  buildLiveAgentPrompt,
  formatSecretaryToAgent,
  LIVE_SECRETARY_TO_AGENT_MARKER,
} from "@drive-coding/core/voice/live-agent-prompt"
import {
  formatAgentDelivery,
  LIVE_AGENT_DELIVERY_MARKER,
  LIVE_PERMISSION_PENDING_MARKER,
} from "@drive-coding/core/voice/live-prompt"
import type { LiveEvent } from "@drive-coding/core/voice/live-types"
import { flushSync } from "svelte"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AgentSession } from "./agent-session.svelte"
import { Live } from "./live.svelte"
import type { Mic } from "./mic.svelte"

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

function createLive(opts: { mic?: Mic; session: AgentSession }): {
  live: Live
  dispose: () => void
} {
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

    expect(session.sendPrompt).toHaveBeenLastCalledWith(formatSecretaryToAgent("fix auth.ts"))
    expect(providerSend).toHaveBeenCalledWith({
      type: "action_result",
      id: "a1",
      name: "compose_prompt",
      result: { status: "sent" },
    })
  })

  it("action_result sent immediately without waiting for agent turn", async () => {
    const session = mockSession({
      sendPrompt: vi.fn(async (): Promise<void> => new Promise<void>(() => {})),
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

    expect(session.sendPrompt).toHaveBeenCalledTimes(1)
    expect(session.sendPrompt).toHaveBeenCalledWith(buildLiveAgentPrompt())
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

    expect(session.sendPrompt).toHaveBeenLastCalledWith(formatSecretaryToAgent("raw ask"))
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
          sessionId: "ses_test",
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
          sessionId: "ses_test",
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

describe("Live unprompted guard flag (Commit 1)", () => {
  it("sets deliveredSinceUserSpoke after agent delivery", async () => {
    const session = mockSession({
      recentAssistantMessages: vi.fn(() => ["Done."]),
    })
    const live = await openLive(session)

    providerOnEvent?.({
      type: "action",
      id: "d1",
      name: "compose_prompt",
      args: { text: "run tests" },
    })

    expect(live.deliveredSinceUserSpokeForTest()).toBe(false)
    live.deliverAgentAnswerIfPending()
    expect(live.deliveredSinceUserSpokeForTest()).toBe(true)
  })

  it("clears deliveredSinceUserSpoke on first user transcript fragment", async () => {
    const session = mockSession({
      recentAssistantMessages: vi.fn(() => ["Done."]),
    })
    const live = await openLive(session)

    providerOnEvent?.({
      type: "action",
      id: "d2",
      name: "compose_prompt",
      args: { text: "run tests" },
    })
    live.deliverAgentAnswerIfPending()
    expect(live.deliveredSinceUserSpokeForTest()).toBe(true)

    providerOnEvent?.({
      type: "transcript",
      role: "user",
      text: "thanks",
      final: false,
    })
    expect(live.deliveredSinceUserSpokeForTest()).toBe(false)
  })

  it("does not rewrite flag on merged user transcript fragments", async () => {
    const session = mockSession({
      recentAssistantMessages: vi.fn(() => ["Done."]),
    })
    const live = await openLive(session)

    providerOnEvent?.({
      type: "action",
      id: "d3",
      name: "compose_prompt",
      args: { text: "run tests" },
    })
    live.deliverAgentAnswerIfPending()

    providerOnEvent?.({
      type: "transcript",
      role: "user",
      text: "hel",
      final: false,
    })
    providerOnEvent?.({
      type: "transcript",
      role: "user",
      text: "lo",
      final: false,
    })
    expect(live.deliveredSinceUserSpokeForTest()).toBe(false)
  })
})

describe("Live unprompted guard wiring (Commit 2)", () => {
  async function liveWithDelivery(session: AgentSession): Promise<Live> {
    const live = await openLive(session)
    providerOnEvent?.({
      type: "action",
      id: "seed",
      name: "compose_prompt",
      args: { text: "initial task" },
    })
    live.deliverAgentAnswerIfPending()
    expect(live.deliveredSinceUserSpokeForTest()).toBe(true)
    return live
  }

  it("blocks compose_prompt after delivery without user speech (DoD 3, 10)", async () => {
    const session = mockSession({
      recentAssistantMessages: vi.fn(() => ["Task complete."]),
    })
    await liveWithDelivery(session)

    providerOnEvent?.({
      type: "action",
      id: "loop1",
      name: "compose_prompt",
      args: { text: "run again" },
    })

    expect(session.sendPrompt).toHaveBeenCalledTimes(2)
    expect(providerSend).toHaveBeenCalledWith({
      type: "action_result",
      id: "loop1",
      name: "compose_prompt",
      result: { status: "not_sent", reason: "unprompted" },
    })
  })

  it("blocks forward with reason unprompted after delivery (DoD 4)", async () => {
    const session = mockSession({
      recentAssistantMessages: vi.fn(() => ["Task complete."]),
    })
    await liveWithDelivery(session)

    providerOnEvent?.({
      type: "action",
      id: "loop2",
      name: "forward",
      args: {},
    })

    expect(session.sendPrompt).toHaveBeenCalledTimes(2)
    expect(providerSend).toHaveBeenCalledWith({
      type: "action_result",
      id: "loop2",
      name: "forward",
      result: { status: "not_sent", reason: "unprompted" },
    })
  })

  it("allows send after delivery once user spoke (DoD 5)", async () => {
    const session = mockSession({
      recentAssistantMessages: vi.fn(() => ["Task complete."]),
    })
    const live = await liveWithDelivery(session)

    providerOnEvent?.({
      type: "transcript",
      role: "user",
      text: "now fix tests",
      final: false,
    })

    providerOnEvent?.({
      type: "action",
      id: "ok1",
      name: "compose_prompt",
      args: { text: "fix tests" },
    })

    expect(session.sendPrompt).toHaveBeenCalledTimes(3)
    expect(session.sendPrompt).toHaveBeenLastCalledWith(formatSecretaryToAgent("fix tests"))
    expect(providerSend).toHaveBeenCalledWith({
      type: "action_result",
      id: "ok1",
      name: "compose_prompt",
      result: { status: "sent" },
    })
    expect(live.deliveredSinceUserSpokeForTest()).toBe(false)
  })

  it("user interruption during delivery window clears flag for next send (DoD 6)", async () => {
    const session = mockSession({
      recentAssistantMessages: vi.fn(() => ["Long answer still playing."]),
    })
    const live = await liveWithDelivery(session)

    providerOnEvent?.({
      type: "transcript",
      role: "user",
      text: "stop",
      final: false,
    })
    expect(live.deliveredSinceUserSpokeForTest()).toBe(false)

    providerOnEvent?.({
      type: "action",
      id: "ok2",
      name: "compose_prompt",
      args: { text: "do something else" },
    })

    expect(session.sendPrompt).toHaveBeenLastCalledWith(formatSecretaryToAgent("do something else"))
    expect(providerSend).toHaveBeenCalledWith({
      type: "action_result",
      id: "ok2",
      name: "compose_prompt",
      result: { status: "sent" },
    })
  })

  it("mutation: forced flag off bypasses unprompted block (DoD 7)", async () => {
    const session = mockSession({
      recentAssistantMessages: vi.fn(() => ["Task complete."]),
    })
    const live = await liveWithDelivery(session)
    live.setDeliveredSinceUserSpokeForTest(false)

    providerOnEvent?.({
      type: "action",
      id: "mut1",
      name: "compose_prompt",
      args: { text: "would loop" },
    })

    expect(session.sendPrompt).toHaveBeenCalledTimes(3)
    expect(providerSend).toHaveBeenCalledWith({
      type: "action_result",
      id: "mut1",
      name: "compose_prompt",
      result: { status: "sent" },
    })
  })
})

describe("Live agent secretary prompt (agent-secretary-prompt)", () => {
  it("sends buildLiveAgentPrompt once after successful open", async () => {
    const session = mockSession()
    await openLive(session)

    expect(session.sendPrompt).toHaveBeenCalledTimes(1)
    expect(session.sendPrompt).toHaveBeenCalledWith(buildLiveAgentPrompt())
  })

  it("does not resend agent prompt on second action in same open cycle", async () => {
    const session = mockSession()
    await openLive(session)

    providerOnEvent?.({
      type: "action",
      id: "x1",
      name: "compose_prompt",
      args: { text: "hello" },
    })

    const agentPromptCalls = (session.sendPrompt as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([text]) => text === buildLiveAgentPrompt(),
    )
    expect(agentPromptCalls).toHaveLength(1)
  })

  it("resets agent prompt on close and resends on reopen", async () => {
    const session = mockSession()
    const { live, dispose } = createLive({ session })
    try {
      await live.toggle()
      expect(session.sendPrompt).toHaveBeenCalledTimes(1)

      await live.toggle()
      expect(live.state).toBe("closed")

      await live.toggle()
      expect(session.sendPrompt).toHaveBeenCalledTimes(2)
      expect(session.sendPrompt).toHaveBeenLastCalledWith(buildLiveAgentPrompt())
    } finally {
      dispose()
    }
  })

  it("compose_prompt and forward prefix secretary marker before sendPrompt", async () => {
    const session = mockSession()
    const live = await openLive(session)

    providerOnEvent?.({
      type: "action",
      id: "tag1",
      name: "compose_prompt",
      args: { text: "fix auth.ts" },
    })
    expect(session.sendPrompt).toHaveBeenLastCalledWith(formatSecretaryToAgent("fix auth.ts"))
    expect((session.sendPrompt as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).toContain(
      LIVE_SECRETARY_TO_AGENT_MARKER,
    )

    live.transcript = [{ id: 0, role: "user", text: "raw ask", final: true }]
    providerOnEvent?.({
      type: "action",
      id: "tag2",
      name: "forward",
      args: {},
    })
    expect(session.sendPrompt).toHaveBeenLastCalledWith(formatSecretaryToAgent("raw ask"))
  })
})
