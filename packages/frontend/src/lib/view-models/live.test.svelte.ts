/**
 * live.test.svelte.ts — integration tests for Live VM wiring.
 *
 * Slice: live-secretary, Commit 0 — outgoing path + dispatch gate.
 * @vitest-environment jsdom
 */

import {
  buildLiveAgentPrompt,
  formatSecretaryDispatch,
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
import { type Palette, ThemeVM } from "./theme.svelte"

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
    on(_event: "frame", h: (f: Float32Array) => void) {
      micFrameHandler = h
      return () => {
        micFrameHandler = null
      }
    }
    get level() {
      return 0
    }
  },
}))

let micFrameHandler: ((f: Float32Array) => void) | null = null
const vadResetMock = vi.fn()
const vadIngestMock = vi.fn(async (frame: Float32Array) => [frame] as readonly Float32Array[])

vi.mock("../engines/live-vad", () => ({
  LiveVad: class {
    loadFailed = false
    load = vi.fn(async () => {})
    ingest = (...args: unknown[]) => vadIngestMock(...args)
    reset = vadResetMock
    armPrime = vi.fn()
  },
}))

beforeEach(() => {
  providerSend.mockClear()
  sessionSend.mockClear()
  micFrameHandler = null
  vadResetMock.mockClear()
  vadIngestMock.mockClear()
  vadIngestMock.mockImplementation(async (frame: Float32Array) => [frame])
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
    bubbles: [] as AgentSession["bubbles"],
    lastUserMessage: "",
    configOptions: [],
    models: null,
    modes: null,
    supports: { thinkingTokens: false },
    sendPrompt: vi.fn(async (text: string) => {
      base.lastUserMessage = text
    }),
    cancelTurn: vi.fn(async () => {}),
    recentAssistantMessages: vi.fn(() => []),
    resolvePermission: vi.fn(),
    applyConfigOption: vi.fn(async () => {}),
    setThinkingTokens: vi.fn(async () => {}),
    ...overrides,
  }
  return base as unknown as AgentSession
}

function mockSettings(overrides: Record<string, unknown> = {}) {
  return {
    screenWakeLock: false,
    locale: "he" as const,
    setScreenWakeLock: vi.fn(),
    setLocale: vi.fn(),
    ...overrides,
  }
}

function mockTheme(overrides: { palette?: Palette; setPalette?: ReturnType<typeof vi.fn> } = {}) {
  const setPalette = overrides.setPalette ?? vi.fn()
  return {
    palette: overrides.palette ?? ("ember" as Palette),
    setPalette,
  } as unknown as ThemeVM
}

function createLive(opts: {
  mic?: Mic
  session: AgentSession
  getVoiceName?: () => string
  getSettings?: () => ReturnType<typeof mockSettings>
  getTheme?: () => ThemeVM
}): {
  live: Live
  dispose: () => void
} {
  let live!: Live
  const settings = opts.getSettings?.() ?? mockSettings()
  const theme = opts.getTheme?.() ?? mockTheme()
  const dispose = $effect.root(() => {
    live = new Live({
      mic: opts.mic ?? mockMic(),
      session: opts.session,
      getVoiceName: opts.getVoiceName,
      getSettings: opts.getSettings ?? (() => settings),
      getTheme: opts.getTheme ?? (() => theme),
    })
  })
  return { live, dispose, settings, theme } as {
    live: Live
    dispose: () => void
    settings: ReturnType<typeof mockSettings>
    theme: ThemeVM
  }
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

    expect(session.sendPrompt).toHaveBeenLastCalledWith(
      formatSecretaryDispatch("fix auth.ts", { includePreamble: true }),
    )
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

    expect(session.sendPrompt).toHaveBeenLastCalledWith(
      formatSecretaryDispatch("raw ask", { includePreamble: true }),
    )
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

    expect(session.sendPrompt).toHaveBeenCalledTimes(1)
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

    expect(session.sendPrompt).toHaveBeenCalledTimes(1)
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

    expect(session.sendPrompt).toHaveBeenCalledTimes(2)
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

    expect(session.sendPrompt).toHaveBeenCalledTimes(2)
    expect(providerSend).toHaveBeenCalledWith({
      type: "action_result",
      id: "mut1",
      name: "compose_prompt",
      result: { status: "sent" },
    })
  })
})

describe("Live agent secretary prompt (agent-secretary-prompt)", () => {
  it("does not send the agent explanation on Live open", async () => {
    const session = mockSession()
    await openLive(session)

    expect(session.sendPrompt).not.toHaveBeenCalled()
  })

  it("prepends the explanation once on the first real dispatch", async () => {
    const session = mockSession()
    await openLive(session)

    providerOnEvent?.({
      type: "action",
      id: "x1",
      name: "compose_prompt",
      args: { text: "hello" },
    })

    expect(session.sendPrompt).toHaveBeenCalledTimes(1)
    expect(session.sendPrompt).toHaveBeenCalledWith(
      formatSecretaryDispatch("hello", { includePreamble: true }),
    )

    providerOnEvent?.({
      type: "action",
      id: "x2",
      name: "compose_prompt",
      args: { text: "again" },
    })

    expect(session.sendPrompt).toHaveBeenCalledTimes(2)
    expect(session.sendPrompt).toHaveBeenLastCalledWith(formatSecretaryToAgent("again"))
    const preambleCalls = (session.sendPrompt as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([text]) => typeof text === "string" && text.includes(buildLiveAgentPrompt()),
    )
    expect(preambleCalls).toHaveLength(1)
  })

  it("does not consume the explanation when dispatch is not_sent", async () => {
    const session = mockSession({ status: "idle" })
    await openLive(session)

    providerOnEvent?.({
      type: "action",
      id: "fail",
      name: "compose_prompt",
      args: { text: "hello" },
    })
    expect(session.sendPrompt).not.toHaveBeenCalled()

    session.status = "connected"
    providerOnEvent?.({
      type: "action",
      id: "ok",
      name: "compose_prompt",
      args: { text: "hello" },
    })
    expect(session.sendPrompt).toHaveBeenCalledTimes(1)
    expect(session.sendPrompt).toHaveBeenCalledWith(
      formatSecretaryDispatch("hello", { includePreamble: true }),
    )
  })

  it("does not resend the explanation after Live close on the same ACP session", async () => {
    const session = mockSession()
    const { live, dispose } = createLive({ session })
    try {
      await live.toggle()
      providerOnEvent?.({
        type: "action",
        id: "first",
        name: "compose_prompt",
        args: { text: "one" },
      })
      expect(session.sendPrompt).toHaveBeenLastCalledWith(
        formatSecretaryDispatch("one", { includePreamble: true }),
      )

      await live.toggle()
      expect(live.state).toBe("closed")

      await live.toggle()
      providerOnEvent?.({
        type: "action",
        id: "second",
        name: "compose_prompt",
        args: { text: "two" },
      })
      expect(session.sendPrompt).toHaveBeenCalledTimes(2)
      expect(session.sendPrompt).toHaveBeenLastCalledWith(formatSecretaryToAgent("two"))
    } finally {
      dispose()
    }
  })

  it("skips the explanation when a user bubble already contains it", async () => {
    const session = mockSession({
      bubbles: [
        {
          kind: "user",
          id: "u1",
          messageId: null,
          createdAt: 0,
          segments: [{ id: "s1", text: formatSecretaryDispatch("earlier", { includePreamble: true }) }],
        },
      ] as AgentSession["bubbles"],
    })
    await openLive(session)
    providerOnEvent?.({
      type: "action",
      id: "next",
      name: "compose_prompt",
      args: { text: "two" },
    })
    expect(session.sendPrompt).toHaveBeenCalledWith(formatSecretaryToAgent("two"))
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
    expect(session.sendPrompt).toHaveBeenLastCalledWith(
      formatSecretaryDispatch("fix auth.ts", { includePreamble: true }),
    )
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

describe("Live context wiring (seed + search + remember)", () => {
  it("injects silent seed from session bubbles on open", async () => {
    const session = mockSession({
      bubbles: [
        {
          kind: "user",
          id: "u1",
          messageId: null,
          createdAt: 0,
          segments: [{ id: "s1", text: "fix auth module" }],
        },
      ] as AgentSession["bubbles"],
      lastUserMessage: "",
    })
    await openLive(session)

    expect(providerSend).toHaveBeenCalledWith({
      type: "context",
      text: "fix auth module",
      channel: "silent",
    })
  })

  it("search_session returns hits from bubbles", async () => {
    const session = mockSession({
      bubbles: [
        {
          kind: "user",
          id: "u1",
          messageId: null,
          createdAt: 0,
          segments: [{ id: "s1", text: "we work on auth.ts" }],
        },
      ] as AgentSession["bubbles"],
    })
    await openLive(session)
    providerSend.mockClear()

    providerOnEvent?.({
      type: "action",
      id: "s1",
      name: "search_session",
      args: { query: "auth" },
    })

    expect(providerSend).toHaveBeenCalledWith({
      type: "action_result",
      id: "s1",
      name: "search_session",
      result: expect.objectContaining({
        totalMatches: 1,
        hits: expect.arrayContaining([
          expect.objectContaining({ role: "user", snippet: expect.stringContaining("auth") }),
        ]),
      }),
    })
  })

  it("read_recent returns the last session messages", async () => {
    const session = mockSession({
      bubbles: [
        {
          kind: "user",
          id: "u1",
          messageId: null,
          createdAt: 0,
          segments: [{ id: "s1", text: "hello" }],
        },
        {
          kind: "message",
          id: "a1",
          messageId: null,
          createdAt: 1,
          segments: [{ id: "s2", text: "world" }],
        },
      ] as AgentSession["bubbles"],
    })
    await openLive(session)
    providerSend.mockClear()

    providerOnEvent?.({
      type: "action",
      id: "r1",
      name: "read_recent",
      args: { count: 2 },
    })

    expect(providerSend).toHaveBeenCalledWith({
      type: "action_result",
      id: "r1",
      name: "read_recent",
      result: expect.objectContaining({
        total: 2,
        returned: 2,
        messages: [
          expect.objectContaining({ role: "user", text: "hello" }),
          expect.objectContaining({ role: "assistant", text: "world" }),
        ],
      }),
    })
  })

  it("read_recent thoughts=true includes thought traces", async () => {
    const session = mockSession({
      bubbles: [
        {
          kind: "thought",
          id: "t1",
          messageId: "m",
          createdAt: 0,
          segments: [{ id: "s0", text: "ponder" }],
        },
        {
          kind: "user",
          id: "u1",
          messageId: null,
          createdAt: 1,
          segments: [{ id: "s1", text: "hello" }],
        },
      ] as AgentSession["bubbles"],
    })
    await openLive(session)
    providerSend.mockClear()

    providerOnEvent?.({
      type: "action",
      id: "r2",
      name: "read_recent",
      args: { thoughts: true },
    })

    expect(providerSend).toHaveBeenCalledWith({
      type: "action_result",
      id: "r2",
      name: "read_recent",
      result: expect.objectContaining({
        messages: [
          expect.objectContaining({ role: "thought", text: "ponder" }),
          expect.objectContaining({ role: "user", text: "hello" }),
        ],
      }),
    })
  })

  it("read_recent can return only full tool calls", async () => {
    const session = mockSession({
      bubbles: [
        {
          kind: "user",
          id: "u1",
          messageId: null,
          createdAt: 0,
          segments: [{ id: "s1", text: "run" }],
        },
        {
          kind: "tool",
          id: "tool1",
          messageId: null,
          createdAt: 1,
          segments: [],
          toolCall: {
            toolCallId: "tc1",
            name: "Read",
            args: { path: "a.ts" },
            status: "completed",
            content: [{ type: "text", text: "ok" }],
          },
        },
      ] as AgentSession["bubbles"],
    })
    await openLive(session)
    providerSend.mockClear()

    providerOnEvent?.({
      type: "action",
      id: "r3",
      name: "read_recent",
      args: { messages: false, toolCalls: true },
    })

    expect(providerSend).toHaveBeenCalledWith({
      type: "action_result",
      id: "r3",
      name: "read_recent",
      result: expect.objectContaining({
        returned: 1,
        messages: [
          expect.objectContaining({
            role: "tool",
            text: "Read",
            tool: expect.objectContaining({
              name: "Read",
              args: '{"path":"a.ts"}',
              output: "ok",
            }),
          }),
        ],
      }),
    })
  })

  it("remember_session upserts and returns items", async () => {
    const session = mockSession()
    await openLive(session)
    providerSend.mockClear()

    providerOnEvent?.({
      type: "action",
      id: "m1",
      name: "remember_session",
      args: { text: "prefer patch commits" },
    })

    expect(providerSend).toHaveBeenCalledWith({
      type: "action_result",
      id: "m1",
      name: "remember_session",
      result: expect.objectContaining({
        ok: true,
        full: false,
        items: [expect.objectContaining({ text: "prefer patch commits" })],
      }),
    })
  })
})

describe("Live getVoiceName at mint", () => {
  it("passes getVoiceName() into fetchLiveToken on open", async () => {
    const { fetchLiveToken } = await import("../adapters/voice/live-token")
    vi.mocked(fetchLiveToken).mockClear()
    const getVoiceName = vi.fn(() => "Charon")
    const session = mockSession()
    const { live, dispose } = createLive({ session, getVoiceName })
    try {
      await live.toggle()
      expect(live.state).toBe("open")
      expect(getVoiceName).toHaveBeenCalled()
      expect(fetchLiveToken).toHaveBeenCalledWith(
        expect.objectContaining({ voiceName: "Charon" }),
      )
    } finally {
      dispose()
    }
  })
})

describe("Live config control (live-config-control)", () => {
  function sessionWithModels() {
    return mockSession({
      models: {
        currentModelId: "anthropic/claude-sonnet",
        availableModels: [
          { modelId: "anthropic/claude-sonnet", name: "Sonnet" },
          { modelId: "anthropic/claude-opus", name: "Opus" },
        ],
      },
      applyConfigOption: vi.fn(async () => {}),
      configOptions: [],
      supports: { thinkingTokens: false },
    })
  }

  it("list_config returns model choices from modelId", async () => {
    const session = sessionWithModels()
    await openLive(session)
    providerSend.mockClear()

    providerOnEvent?.({
      type: "action",
      id: "cfg1",
      name: "list_config",
      args: {},
    })

    expect(providerSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "action_result",
        name: "list_config",
        result: expect.objectContaining({
          status: "ok",
          session: expect.objectContaining({
            model: expect.objectContaining({
              choices: expect.arrayContaining([
                expect.objectContaining({ id: "anthropic/claude-sonnet" }),
              ]),
            }),
          }),
        }),
      }),
    )
  })

  it("set_session_config model calls applyConfigOption with model id", async () => {
    const applyConfigOption = vi.fn(async () => {})
    const session = mockSession({
      models: {
        currentModelId: "anthropic/claude-sonnet",
        availableModels: [{ modelId: "anthropic/claude-sonnet", name: "Sonnet" }],
      },
      applyConfigOption,
      configOptions: [],
    })
    await openLive(session)
    providerSend.mockClear()

    providerOnEvent?.({
      type: "action",
      id: "cfg2",
      name: "set_session_config",
      args: { id: "model", value: "anthropic/claude-sonnet" },
    })

    expect(applyConfigOption).toHaveBeenCalledWith("model", "anthropic/claude-sonnet")
    expect(providerSend).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({ status: "ok", id: "model" }),
      }),
    )
  })

  it("set_session_config when not connected returns not-connected", async () => {
    const session = mockSession({ status: "idle" })
    await openLive(session)
    providerSend.mockClear()

    providerOnEvent?.({
      type: "action",
      id: "cfg3",
      name: "set_session_config",
      args: { id: "model", value: "x" },
    })

    expect(providerSend).toHaveBeenCalledWith({
      type: "action_result",
      id: "cfg3",
      name: "set_session_config",
      result: { status: "error", reason: "not-connected" },
    })
  })

  it("set_app_setting theme updates palette", async () => {
    const setPalette = vi.fn()
    const session = mockSession()
    const { live, dispose } = createLive({
      session,
      getTheme: () => mockTheme({ setPalette }),
    })
    try {
      await live.toggle()
      providerSend.mockClear()

      providerOnEvent?.({
        type: "action",
        id: "cfg4",
        name: "set_app_setting",
        args: { key: "theme", value: "daylight" },
      })

      expect(setPalette).toHaveBeenCalledWith("daylight")
    } finally {
      dispose()
    }
  })

  it("set_app_setting unknown key returns unknown-key", async () => {
    const session = mockSession()
    await openLive(session)
    providerSend.mockClear()

    providerOnEvent?.({
      type: "action",
      id: "cfg5",
      name: "set_app_setting",
      args: { key: "carMode", value: "true" },
    })

    expect(providerSend).toHaveBeenCalledWith({
      type: "action_result",
      id: "cfg5",
      name: "set_app_setting",
      result: { status: "error", reason: "unknown-key" },
    })
  })

  it("set_session_config boolean option passes boolean to applyConfigOption", async () => {
    const applyConfigOption = vi.fn(async () => {})
    const session = mockSession({
      applyConfigOption,
      configOptions: [
        {
          id: "verbose",
          name: "Verbose",
          type: "boolean",
          category: null,
          currentValue: false,
        },
      ],
    })
    await openLive(session)
    providerSend.mockClear()

    providerOnEvent?.({
      type: "action",
      id: "cfg6",
      name: "set_session_config",
      args: { id: "verbose", value: "true" },
    })

    expect(applyConfigOption).toHaveBeenCalledWith("verbose", true)
  })

  it("injects Hebrew config seed on open", async () => {
    const session = sessionWithModels()
    const { live, dispose } = createLive({
      session,
      getTheme: () => mockTheme({ palette: "daylight" }),
    })
    try {
      await live.toggle()
      expect(providerSend).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "context",
          channel: "silent",
          text: expect.stringContaining("[הגדרות נוכחיות]"),
        }),
      )
    } finally {
      dispose()
    }
  })
})

describe("Live pause/resume (live-silence-cost)", () => {
  it("pause does not close the session", async () => {
    const session = mockSession()
    const live = await openLive(session)
    live.pause()
    expect(live.paused).toBe(true)
    expect(live.state).toBe("open")
  })

  it("resume resets filter and forwards audio again", async () => {
    const session = mockSession()
    const live = await openLive(session)
    providerSend.mockClear()

    live.pause()
    micFrameHandler?.(new Float32Array(1280))
    await Promise.resolve()
    expect(providerSend).not.toHaveBeenCalledWith(expect.objectContaining({ type: "audio" }))

    live.resume()
    expect(live.paused).toBe(false)
    expect(vadResetMock).toHaveBeenCalled()

    micFrameHandler?.(new Float32Array(1280))
    await Promise.resolve()
    expect(providerSend).toHaveBeenCalledWith(expect.objectContaining({ type: "audio" }))
  })

  it("pause_live sends result then pauses without closing", async () => {
    const session = mockSession()
    const live = await openLive(session)
    providerSend.mockClear()

    providerOnEvent?.({
      type: "action",
      id: "p1",
      name: "pause_live",
      args: {},
    })

    expect(providerSend).toHaveBeenCalledWith({
      type: "action_result",
      id: "p1",
      name: "pause_live",
      result: { status: "paused" },
    })
    expect(live.paused).toBe(true)
    expect(live.state).toBe("open")
  })

  it("pause_live when already paused returns already_paused", async () => {
    const session = mockSession()
    const live = await openLive(session)
    live.pause()
    providerSend.mockClear()

    providerOnEvent?.({
      type: "action",
      id: "p2",
      name: "pause_live",
      args: {},
    })

    expect(providerSend).toHaveBeenCalledWith({
      type: "action_result",
      id: "p2",
      name: "pause_live",
      result: { status: "already_paused" },
    })
  })

  it("close_live sends closing then closes like Stop", async () => {
    const session = mockSession()
    const live = await openLive(session)
    providerSend.mockClear()

    providerOnEvent?.({
      type: "action",
      id: "c1",
      name: "close_live",
      args: {},
    })

    expect(providerSend).toHaveBeenCalledWith({
      type: "action_result",
      id: "c1",
      name: "close_live",
      result: { status: "closing" },
    })
    expect(live.state).toBe("open")
    await vi.waitFor(() => {
      expect(live.state).toBe("closed")
    })
  })
})
