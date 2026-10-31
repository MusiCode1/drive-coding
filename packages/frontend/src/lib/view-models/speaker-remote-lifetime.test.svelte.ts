/**
 * @vitest-environment jsdom
 * speaker.test.svelte.ts — TDD ל-Commit 0: FetchOutcome + markAbandoned.
 */

import * as sessionCore from "@drive-coding/core/session"
import {
  applyPatch,
  createInitialSessionState,
  type Patch,
  reduce,
  type SessionState,
  serializeFrame,
  snapshotFrame,
  updateFrame,
} from "@drive-coding/core/session"
import { OrderAllocator } from "@drive-coding/core/voice/tts-queue"
import { tick } from "svelte"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AudioPlaylist } from "$lib/engines/audio-playlist.svelte"
import type { AudioSink } from "$lib/engines/audio-sink"
import { RemoteSessionView } from "$lib/session/remote-session-view"
import * as projector from "$lib/session/session-view-projection"
import type { Bubble, MessageBubble } from "$lib/types/bubble"
import { translate } from "../adapters/voice/translate"
import { AgentSession } from "./agent-session.svelte"
import { Settings } from "./settings.svelte"
import { Speaker } from "./speaker.svelte"

const mockSynthesize = vi.fn()
// params declared so the spread into it typechecks against the real
// `isAvailable(provider)` signature on ttsCapabilities
const mockIsAvailable = vi.fn((_provider: "elevenlabs" | "google") => true)
const mockNarrate = vi.fn()

vi.mock("$lib/adapters/voice/tts-resolve", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/adapters/voice/tts-resolve")>()
  return {
    ...actual,
    resolveTts: vi.fn(() => ({
      provider: {
        format: "pcm" as const,
        synthesize: (...args: unknown[]) => mockSynthesize(...args),
      },
      voiceId: "voice",
      modelId: "model",
    })),
  }
})

vi.mock("./capabilities.svelte", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./capabilities.svelte")>()
  return {
    ...actual,
    ttsCapabilities: {
      ...actual.ttsCapabilities,
      isAvailable: (provider: "elevenlabs" | "google") => mockIsAvailable(provider),
    },
  }
})

vi.mock("../adapters/voice/translate", () => ({ translate: vi.fn() }))
vi.mock("../adapters/voice/narrate", () => ({
  narrate: (...args: unknown[]) => mockNarrate(...args),
}))
vi.mock("@drive-coding/core/voice/cache-key", () => ({
  cacheKeyFor: vi.fn(async () => "hash"),
}))

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    },
  }
})()
vi.stubGlobal("localStorage", localStorageMock)

const LONG_TEXT =
  "This is a long enough sentence for the speaker to enqueue a TTS job without waiting for turn end."

const cleanup: (() => void)[] = []
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn()
})
async function settle() {
  for (let i = 0; i < 10; i++) await tick()
  await new Promise((r) => setTimeout(r, 0))
}
async function until(test: () => boolean) {
  for (let i = 0; i < 100; i++) {
    await settle()
    if (test()) return
  }
  throw new Error("condition was not entered")
}
function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: Error) => void
  const promise = new Promise<T>((y, n) => {
    resolve = y
    reject = n
  })
  return { promise, resolve, reject }
}
function json(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response
}
async function harness(observer?: (u: unknown) => void) {
  let state: SessionState = {
    ...createInitialSessionState({ sessionId: "same" }),
    version: 1,
    status: "connected" as const,
    turnState: "waiting" as const,
    messages: [
      {
        id: "seed",
        role: "user" as const,
        messageId: "seed",
        segments: [{ id: "seed_s", text: "Historical seed" }],
      },
    ],
    nextMessageSeq: 1,
    nextSegmentSeq: 1,
  }
  let hostIncarnation = "fixture-host"
  let ctrl!: ReadableStreamDefaultController<Uint8Array>,
    fetches = 0,
    reconnects = 0
  const rpc: ReturnType<typeof deferred<Response>>[] = []
  const encoder = new TextEncoder()
  const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith("/events")) {
      fetches++
      return {
        ok: true,
        status: 200,
        body: new ReadableStream<Uint8Array>({
          start(c) {
            ctrl = c
            c.enqueue(
              encoder.encode(serializeFrame(snapshotFrame(state, undefined, { hostIncarnation }))),
            )
          },
        }),
      } as Response
    }
    if (url.endsWith("/rpc")) {
      const next = rpc.shift()
      return next ? next.promise : json({ sessionId: "same" })
    }
    return json({})
  })
  const view = new RemoteSessionView("agent", "http://synthetic", {
    _fetch: fetchImpl,
    _sleep: async () => {},
    onSseReconnected: () => {
      reconnects++
    },
  })
  const settings = new Settings()
  settings.ttsProvider = "google"
  settings.muted = false
  settings.narrateTools = true
  settings.speakThoughts = true
  settings.translateThoughts = true
  const agent = new AgentSession({ view, settings, _onUpdateObserved: observer })
  const sink: AudioSink = {
    prepareSegment: async () => {},
    play: async () => {},
    cancel: () => {},
    clear: () => {},
    pause: () => {},
    resume: () => {},
    isComplete: () => false,
  }
  const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })
  const reserve = vi.spyOn(playlist, "reserve")
  const port = agent.speakerTranscript()
  const speaker = new Speaker({
    session: port,
    settings,
    playlist,
    audioStream: sink,
    orderAlloc: new OrderAllocator(),
  })
  cleanup.push(() => {
    speaker.destroy()
    void view.close()
  })
  await view.connect()
  await settle()
  async function patch(body: Record<string, unknown>) {
    const p = { version: state.version + 1, ...body } as Patch
    state = applyPatch(state, p)!
    ctrl.enqueue(encoder.encode(serializeFrame(updateFrame(state, p)!)))
    await until(() => view.state.version === p.version)
  }
  async function raw(updates: unknown[], version = state.version + 1) {
    for (const u of updates) state = { ...reduce(state, u).state, version }
    ctrl.enqueue(
      encoder.encode(
        serializeFrame({
          event: "update",
          id: String(version),
          data: JSON.stringify(
            updates.map((update) => ({
              jsonrpc: "2.0",
              method: "session/update",
              params: { sessionId: "same", update },
            })),
          ),
        }),
      ),
    )
    await until(() => view.state.version === version)
  }
  async function reconnect(next = { ...state, version: state.version + 10 }) {
    state = next
    const old = reconnects
    const previousFetches = fetches
    const oldA = port.captureTarget()
    ctrl.close()
    await until(() => reconnects === old + 1)
    expect(fetches).toBe(previousFetches + 1)
    expect(port.captureTarget()).not.toBe(oldA)
    expect(agent.historyEpoch).toBe(1)
  }
  async function rejectedSnapshot(next: SessionState) {
    state = next
    const before = fetches
    ctrl.close()
    await until(() => fetches === before + 1)
    await settle()
  }
  async function tool() {
    await patch({
      op: "add-message",
      message: {
        id: "m_tool",
        role: "tool",
        messageId: null,
        toolCall: {
          toolCallId: "repeat",
          name: "run",
          kind: "other",
          status: "completed",
          args: {},
        },
      },
    })
  }
  async function message(text: string) {
    await patch({
      op: "add-message",
      message: { id: "m_0", role: "assistant", messageId: "live", segments: [{ id: "s_0", text }] },
    })
  }
  async function append(text: string) {
    await patch({
      op: "append-segment",
      targetId: "m_0",
      segment: { id: `s_${state.nextSegmentSeq}`, text },
    })
  }
  return {
    agent,
    view,
    port,
    speaker,
    reserve,
    patch,
    raw,
    reconnect,
    tool,
    message,
    append,
    rpc,
    getState: () => structuredClone(state),
    fetchImpl,
    rejectedSnapshot,
    recreate: async (next: SessionState) => {
      state = next
      hostIncarnation = "recreated-host"
      const previous = reconnects
      ctrl.close()
      await until(() => reconnects === previous + 1)
    },
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(translate).mockReset()
  localStorageMock.clear()
  mockIsAvailable.mockReturnValue(true)
  mockSynthesize.mockImplementation(async () => new ReadableStream())
  mockNarrate.mockResolvedValue("Narration sufficiently long for a current tool.")
})

describe("same-view reconnect parity", () => {
  for (const mode of [
    "same",
    "prefix-new",
    "collapse-two",
    "speak-tail",
    "raw-tail",
    "tool",
    "stop",
  ] as const) {
    it(`second fetch preserves processing lifetime: ${mode}`, async () => {
      const h = await harness()
      if (mode === "tool") await h.tool()
      else
        await h.message(
          mode === "speak-tail"
            ? "Legal partial"
            : mode === "raw-tail"
              ? "Intro [visible label"
              : "Already spoken complete sentence with enough characters.",
        )
      if (mode === "collapse-two") await h.append(" Second prior sentence with enough characters.")
      if (mode === "stop") h.speaker.stop()
      await settle()
      const n = h.reserve.mock.calls.length,
        p = h.port.processingTarget,
        narrations = mockNarrate.mock.calls.length
      const next = h.getState()
      next.version += 10
      if (mode === "prefix-new") {
        const m = next.messages.find((m) => m.id === "m_0")!
        if (m.role !== "tool")
          m.segments.push({
            id: "s_offline",
            text: " New offline sentence with enough characters.",
          })
        next.nextSegmentSeq++
      }
      await h.reconnect(next)
      await settle()
      expect(h.port.processingTarget).toBe(p)
      expect(h.reserve).toHaveBeenCalledTimes(n)
      expect(mockNarrate).toHaveBeenCalledTimes(narrations)
      if (mode === "speak-tail") {
        await h.append(" continuation with sufficient characters to complete sentence.")
        expect(JSON.stringify(mockSynthesize.mock.calls)).toContain("Legal partial continuation")
      }
      if (mode === "raw-tail") {
        await h.append(
          "](https://example.com) continuation with sufficient characters to complete sentence.",
        )
        expect(JSON.stringify(mockSynthesize.mock.calls)).toContain("visible label")
      }
      if (mode === "prefix-new") {
        await h.append(" New online sentence with enough characters.")
        expect(h.reserve.mock.calls.length).toBeGreaterThan(n)
      }
      if (mode === "collapse-two") {
        await h.append(" First online chunk with enough characters.")
        expect(h.reserve).toHaveBeenCalledTimes(n)
        await h.append(" Second online chunk with enough characters.")
        expect(h.reserve.mock.calls.length).toBeGreaterThan(n)
      }
    })
  }
})

describe("remote replacement intent consumer", () => {
  for (const sameId of [true, false])
    it(`success-before-snapshot resets P and repeated callID same=${sameId}`, async () => {
      const h = await harness()
      await h.tool()
      expect(mockNarrate).toHaveBeenCalledTimes(1)
      const p = h.port.processingTarget
      await h.view.loadSession(sameId ? "same" : "other")
      const next = h.getState()
      next.version += 10
      next.sessionId = sameId ? "same" : "other"
      await h.reconnect(next)
      expect(h.port.processingTarget).not.toBe(p)
      expect(mockNarrate).toHaveBeenCalledTimes(2)
    })
  it("success I1 then rejected I2 retains the previous obligation", async () => {
    const h = await harness()
    await h.tool()
    const p = h.port.processingTarget
    await h.view.loadSession("same")
    const gate = deferred<Response>()
    h.rpc.push(gate)
    const pending = h.view.loadSession("same").catch((e) => e)
    expect(h.fetchImpl).toHaveBeenCalled()
    gate.resolve(json({ error: "rejected" }, false))
    expect(await pending).toBeInstanceOf(Error)
    await h.reconnect()
    expect(h.port.processingTarget).not.toBe(p)
    expect(mockNarrate).toHaveBeenCalledTimes(2)
  })
  it("single rejection and old failed intent behind newer failure preserve continuation", async () => {
    const h = await harness()
    await h.tool()
    const p = h.port.processingTarget
    const a = deferred<Response>(),
      b = deferred<Response>()
    h.rpc.push(a, b)
    const pa = h.view.loadSession("same").catch((e) => e),
      pb = h.view.loadSession("same").catch((e) => e)
    a.reject(new Error("old failed"))
    await pa
    b.reject(new Error("new failed"))
    await pb
    await h.reconnect()
    expect(h.port.processingTarget).toBe(p)
    expect(mockNarrate).toHaveBeenCalledTimes(1)
  })
  for (const kind of ["raw", "snapshot"] as const)
    it(`${kind} before reply does not reset early chunks again`, async () => {
      const h = await harness()
      const gate = deferred<Response>()
      h.rpc.push(gate)
      const pending = h.view.loadSession("same")
      if (kind === "raw")
        await h.raw([
          { sessionUpdate: "_drive/reset", messages: [], nextMessageSeq: 0, nextSegmentSeq: 0 },
        ])
      else await h.reconnect()
      const p = h.port.processingTarget
      await h.message("Early content is preserved after the RPC reply completes.")
      gate.resolve(json({ sessionId: "same" }))
      await pending
      expect(h.port.processingTarget).toBe(p)
      expect(JSON.stringify(h.agent.bubbles)).toContain("Early content")
    })
  it("reentrant raw barrier consumes captured I1 despite observer I2 and both catches", async () => {
    let start: (() => void) | undefined
    const h = await harness((u) => {
      if ((u as { sessionUpdate: string }).sessionUpdate === "_drive/reset") start?.()
    })
    await h.view.loadSession("same") // I0 success, still unconsumed
    const i1 = deferred<Response>(),
      i2 = deferred<Response>()
    h.rpc.push(i1, i2)
    const p1 = h.view.loadSession("same").catch((e) => e)
    let p2!: Promise<unknown>
    start = () => {
      p2 = h.view.loadSession("same").catch((e) => e)
    }
    await h.raw([
      { sessionUpdate: "_drive/reset", messages: [], nextMessageSeq: 0, nextSegmentSeq: 0 },
    ])
    expect(p2).toBeDefined()
    await h.tool()
    const p = h.port.processingTarget
    i1.reject(new Error("I1 failed"))
    await p1
    i2.reject(new Error("I2 failed"))
    await p2
    await h.reconnect()
    expect(h.port.processingTarget).toBe(p)
    expect(mockNarrate).toHaveBeenCalledTimes(1)
  })
})

describe("thought completion counts across reconnect", () => {
  it("accepted completion count survives A replacement and old deferred completion does not advance it", async () => {
    const h = await harness()
    const translated = (text: string) => ({ status: "translated" as const, text })
    vi.mocked(translate).mockResolvedValueOnce(translated("First translated sentence."))
    await h.raw([
      {
        sessionUpdate: "agent_thought_chunk",
        messageId: "thought",
        content: {
          type: "text",
          text: "First thought sentence with enough characters to enqueue.",
        },
      },
    ])
    await settle()
    expect(translate).toHaveBeenCalledTimes(1)
    await h.reconnect()
    vi.mocked(translate).mockResolvedValueOnce(translated("Second translated sentence."))
    await h.raw([
      {
        sessionUpdate: "agent_thought_chunk",
        messageId: "thought",
        content: {
          type: "text",
          text: " Second thought sentence with enough characters to enqueue.",
        },
      },
    ])
    await settle()
    const b = h.agent.bubbles.find((b) => b.kind === "thought")
    expect(b?.kind === "thought" && b.segments[1]?.text).toBe("Second translated sentence.")
    const stale = deferred<{ status: "translated"; text: string }>()
    vi.mocked(translate).mockReturnValueOnce(stale.promise as never)
    await h.raw([
      {
        sessionUpdate: "agent_thought_chunk",
        messageId: "thought",
        content: {
          type: "text",
          text: " Third thought sentence with enough characters to enqueue.",
        },
      },
    ])
    await settle()
    expect(translate).toHaveBeenCalledTimes(3)
    await h.reconnect()
    stale.resolve(translated("STALE THIRD"))
    await settle()
    vi.mocked(translate).mockResolvedValueOnce(translated("Current third completion."))
    await h.raw([
      {
        sessionUpdate: "agent_thought_chunk",
        messageId: "thought",
        content: {
          type: "text",
          text: " Fourth thought sentence with enough characters to enqueue.",
        },
      },
    ])
    await settle()
    await h.raw([
      {
        sessionUpdate: "agent_thought_chunk",
        messageId: "thought",
        content: {
          type: "text",
          text: " Fifth thought sentence after collapsed segment cursor catches up.",
        },
      },
    ])
    await h.raw([
      {
        sessionUpdate: "agent_thought_chunk",
        messageId: "thought",
        content: {
          type: "text",
          text: " Sixth thought sentence reaches the next accepted processing index.",
        },
      },
    ])
    await settle()
    expect(JSON.stringify(h.agent.bubbles)).not.toContain("STALE THIRD")
    expect(JSON.stringify(mockSynthesize.mock.calls)).not.toContain("STALE THIRD")
    expect(JSON.stringify(h.agent.bubbles)).toContain("Current third completion.")
    const current = h.agent.bubbles.find((b) => b.kind === "thought")
    expect(current?.kind === "thought" && current.segments[2]?.text).toBe(
      "Current third completion.",
    )
  })
  it("append from producer preserves captured source and both identities", async () => {
    const h = await harness()
    const gate = deferred<{ status: "translated"; text: string }>()
    vi.mocked(translate).mockReturnValueOnce(gate.promise as never)
    await h.raw([
      {
        sessionUpdate: "agent_thought_chunk",
        messageId: "thought",
        content: {
          type: "text",
          text: "A first thought sentence which is long enough to translate.",
        },
      },
    ])
    expect(translate).toHaveBeenCalledOnce()
    const a = h.port.captureTarget(),
      p = h.port.processingTarget
    await h.raw([
      {
        sessionUpdate: "agent_thought_chunk",
        messageId: "thought",
        content: { type: "text", text: " short tail" },
      },
    ])
    expect(h.port.captureTarget()).toBe(a)
    expect(h.port.processingTarget).toBe(p)
    gate.resolve({ status: "translated", text: "Accepted first thought." })
    await settle()
    expect(JSON.stringify(h.agent.bubbles)).toContain("Accepted first thought.")
    expect(mockSynthesize).toHaveBeenCalledOnce()
  })
})

describe("HTTP structural reset and terminal UI failure", () => {
  it("reset reaches transcript then holder before observer, and observer throw preserves it", async () => {
    let h: Awaited<ReturnType<typeof harness>> | undefined
    const observations: unknown[] = []
    h = await harness((u) => {
      if ((u as { sessionUpdate: string }).sessionUpdate === "_drive/reset") {
        observations.push({
          bubbles: h!.agent.bubbles.length,
          messages: h!.agent.sessionState.messages.length,
          canonical: h!.view.state.messages.length,
          epoch: h!.agent.historyEpoch,
        })
        throw new Error("observer failure")
      }
    })
    await h.message("Content that will be cleared by the structural reset.")
    await h.raw([{ sessionUpdate: "_drive/reset" }])
    expect(observations).toEqual([{ bubbles: 0, messages: 0, canonical: 0, epoch: 1 }])
    expect(h.agent.bubbles).toHaveLength(0)
    await h.raw([
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "control-only content" },
      },
    ])
    expect(h.agent.bubbles).toHaveLength(0)
    expect(JSON.stringify(h.view.state.messages)).toContain("control-only content")
    await h.raw([
      {
        sessionUpdate: "_drive/session_update",
        changes: {
          pending: {
            permission: { requestId: 7, params: { options: [], toolCall: { toolCallId: "p" } } },
            elicitation: {
              requestId: 8,
              params: { mode: "form", message: "request", requestedSchema: { type: "object" } },
            },
          },
        },
      },
    ])
    expect(h.view.state.pending.permission?.requestId).toBe(7)
    expect(h.view.state.pending.elicitation?.requestId).toBe(8)
    expect(h.agent.pendingPermission).toBeNull()
    await h.view.respond(7, { outcome: { outcome: "cancelled" } })
    await h.view.respond(8, { action: "cancel" })
    const replies = h.fetchImpl.mock.calls.filter(([url]) => url.endsWith("/reply"))
    expect(replies).toHaveLength(2)
    expect(JSON.parse(String(replies[0]?.[1]?.body))).toMatchObject({
      kind: "permission",
      requestId: 7,
    })
    expect(JSON.parse(String(replies[1]?.[1]?.body))).toMatchObject({
      kind: "elicitation",
      requestId: 8,
    })
    const before = h.fetchImpl.mock.calls.length
    await h.view.cancel()
    await h.view.close()
    expect(h.fetchImpl.mock.calls.length).toBeGreaterThan(before)
    expect(observations).toHaveLength(1)
  })
})

it("producer fault keeps prefix, rejects duplicate and repairs from admitted snapshot", async () => {
  const h = await harness()
  const observed: string[] = []
  const original = projector.projectSessionUpdate
  const spy = vi.spyOn(projector, "projectSessionUpdate").mockImplementation((...args) => {
    const raw = args[1] as { content?: { text?: string } }
    if (raw.content?.text === "FAULT") throw Error("injected producer fault")
    observed.push(raw.content?.text ?? "")
    return original(...args)
  })
  try {
    const updates = ["PREFIX", "FAULT", "REST"].map((text) => ({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text },
    }))
    await h.raw(updates, 5)
    expect(h.view.debugInfo().lastVersion).toBe(1)
    expect(h.view.state.version).toBe(5)
    expect(JSON.stringify(h.view.state.messages)).toContain("PREFIX")
    expect(JSON.stringify(h.view.state.messages)).not.toContain("REST")
    expect(JSON.stringify(h.agent.bubbles)).not.toContain("REST")
    expect(observed.filter((x) => x === "PREFIX")).toHaveLength(1)
    const repair = h.getState()
    await h.raw(updates, 5)
    expect(observed.filter((x) => x === "PREFIX")).toHaveLength(1)
    await h.reconnect(repair)
    expect(h.view.debugInfo().lastVersion).toBe(5)
    expect(JSON.stringify(h.agent.bubbles)).toContain("REST")
    spy.mockRestore()
    await h.raw(
      [{ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "LATER" } }],
      6,
    )
    expect(JSON.stringify(h.agent.bubbles)).toContain("LATER")
  } finally {
    spy.mockRestore()
  }
})

it("HTTP raw is reduced once and nested child is never reduced top-level", async () => {
  const h = await harness()
  const reduceSpy = vi.spyOn(sessionCore, "reduce")
  try {
    const pending = h.raw([
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "A canonical frame" },
      },
    ])
    reduceSpy.mockClear() // server fixture folding completed synchronously before wire delivery
    await pending
    expect(reduceSpy).toHaveBeenCalledOnce()
    await h.raw([
      {
        sessionUpdate: "tool_call",
        toolCallId: "parent",
        kind: "other",
        title: "parent",
        status: "in_progress",
      },
    ])
    const nested = h.raw([
      {
        sessionUpdate: "tool_call",
        toolCallId: "child",
        kind: "read",
        title: "child",
        status: "in_progress",
        _meta: { claudeCode: { parentToolUseId: "parent" } },
      },
    ])
    reduceSpy.mockClear()
    await nested
    expect(reduceSpy).not.toHaveBeenCalled()
    expect(h.view.state.messages.filter((m) => m.role === "tool")).toHaveLength(1)
  } finally {
    reduceSpy.mockRestore()
  }
})

it("rejected snapshot leaves replacement obligation for the next admitted snapshot", async () => {
  const h = await harness()
  await h.tool()
  const p = h.port.processingTarget,
    a = h.port.captureTarget()
  await h.view.loadSession("same")
  const next = h.getState()
  await h.rejectedSnapshot(next)
  expect(h.port.captureTarget()).toBe(a)
  expect(h.port.processingTarget).toBe(p)
  next.version += 10
  await h.reconnect(next)
  expect(h.port.processingTarget).not.toBe(p)
  expect(mockNarrate).toHaveBeenCalledTimes(2)
})

it("failed raw reset producer does not consume replacement intent", async () => {
  const h = await harness()
  await h.tool()
  const p = h.port.processingTarget
  await h.view.loadSession("same")
  const original = projector.projectSessionUpdate
  const fault = vi.spyOn(projector, "projectSessionUpdate").mockImplementation((...args) => {
    if ((args[1] as { sessionUpdate: string }).sessionUpdate === "_drive/reset")
      throw Error("reset producer fault")
    return original(...args)
  })
  try {
    await expect(h.raw([{ sessionUpdate: "_drive/reset" }], 5)).rejects.toThrow(
      "condition was not entered",
    )
  } finally {
    fault.mockRestore()
  }
  await h.reconnect()
  expect(h.port.processingTarget).not.toBe(p)
  await h.tool()
  expect(mockNarrate).toHaveBeenCalledTimes(2)
})

it("recreated host replays text/thought/tool silently with new history target and then speaks live text", async () => {
  const h = await harness()
  await h.message(LONG_TEXT)
  const oldProcessing = h.port.processingTarget
  const oldAnnotation = h.port.captureTarget()
  const before = {
    reserve: h.reserve.mock.calls.length,
    translate: vi.mocked(translate).mock.calls.length,
    narrate: mockNarrate.mock.calls.length,
    synthesize: mockSynthesize.mock.calls.length,
  }
  const next = h.getState()
  next.version = 0
  next.messages = [
    {
      id: "m_0",
      role: "assistant",
      messageId: "replayed",
      segments: [{ id: "s_0", text: LONG_TEXT }],
    },
    {
      id: "m_1",
      role: "thought",
      messageId: "thought",
      segments: [{ id: "s_1", text: LONG_TEXT }],
    },
    {
      id: "m_2",
      role: "tool",
      messageId: null,
      toolCall: {
        toolCallId: "history-tool",
        name: "run",
        kind: "other",
        status: "completed",
        args: {},
      },
    },
  ]
  next.nextMessageSeq = 3
  next.nextSegmentSeq = 2
  await h.recreate(next)
  await settle()
  expect(h.port.processingTarget).not.toBe(oldProcessing)
  expect(h.port.isCurrent(oldAnnotation)).toBe(false)
  expect(h.port.historyEpoch).toBe(2)
  expect(h.port.historyMark.processingTarget).toBe(h.port.processingTarget)
  expect(h.port.historyMark.mark.toolCallIds).toEqual(["history-tool"])
  expect([...h.port.historyMark.mark.segmentCounts.values()]).toEqual([1, 1])
  expect(h.reserve).toHaveBeenCalledTimes(before.reserve)
  expect(translate).toHaveBeenCalledTimes(before.translate)
  expect(mockNarrate).toHaveBeenCalledTimes(before.narrate)
  expect(mockSynthesize).toHaveBeenCalledTimes(before.synthesize)
  await h.raw(
    [
      {
        sessionUpdate: "agent_message_chunk",
        messageId: "new-live",
        content: {
          type: "text",
          text: "New host live sentence with enough characters to speak immediately.",
        },
      },
    ],
    1,
  )
  await until(() => h.reserve.mock.calls.length > before.reserve)
  expect(JSON.stringify(mockSynthesize.mock.calls)).toContain("New host live sentence")
})
