/**
 * @vitest-environment jsdom
 * speaker.test.svelte.ts — TDD ל-Commit 0: FetchOutcome + markAbandoned.
 */

import {
  createInitialSessionState,
  serializeFrame,
  snapshotFrame,
} from "@drive-coding/core/session"
import { cacheKeyFor } from "@drive-coding/core/voice/cache-key"
import { OrderAllocator } from "@drive-coding/core/voice/tts-queue"
import { tick } from "svelte"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AudioPlaylist } from "$lib/engines/audio-playlist.svelte"
import type { AudioSink } from "$lib/engines/audio-sink"
import { RemoteSessionView } from "$lib/session/remote-session-view"
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

const active: { speaker: Speaker; session: AgentSession }[] = []
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
async function flush() {
  for (let i = 0; i < 30; i++) await tick()
}
function message(text: string, count = 1): Bubble {
  return {
    id: "same",
    kind: "message",
    messageId: "msg",
    createdAt: 0,
    segments: Array.from({ length: count }, (_, i) => ({ id: `s${i}`, text })),
  }
}
function thought(text = LONG_TEXT): Bubble {
  return { ...message(text), kind: "thought" } as Bubble
}
function tool(): Bubble {
  return {
    id: "tool",
    kind: "tool",
    messageId: null,
    createdAt: 0,
    segments: [],
    toolCall: {
      toolCallId: "call",
      kind: "other",
      name: "run",
      title: "run",
      args: {},
      status: "completed",
    },
  }
}
function harness(bubbles: Bubble[] | undefined = [], responding = false, existing?: AgentSession) {
  const session = existing ?? new AgentSession()
  if (!existing || bubbles !== undefined) session.bubbles = bubbles ?? []
  session.status = "connected"
  session.turnState = responding ? "responding" : "idle"
  const settings = new Settings()
  settings.ttsProvider = "google"
  settings.muted = false
  settings.narrateTools = true
  settings.translateThoughts = true
  settings.speakThoughts = true
  const prepared: string[] = []
  const sink: AudioSink = {
    prepareSegment: async (id) => {
      prepared.push(id)
    },
    play: async () => {},
    cancel: () => {},
    clear: () => {},
    pause: () => {},
    resume: () => {},
    isComplete: () => false,
  }
  const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })
  const speaker = new Speaker({
    session: session.speakerTranscript(),
    settings,
    playlist,
    audioStream: sink,
    orderAlloc: new OrderAllocator(),
  })
  active.push({ speaker, session })
  return { session, settings, speaker, playlist, prepared, sink }
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorageMock.clear()
  mockIsAvailable.mockReturnValue(true)
  mockSynthesize.mockImplementation(async () => new ReadableStream<Uint8Array>())
  mockNarrate.mockResolvedValue("Tool narration with enough text.")
})
afterEach(() => {
  for (const h of active.splice(0)) {
    h.speaker.destroy()
    h.session.detach()
  }
})

describe("Speaker transcript safety", () => {
  for (const prefix of ["old tail ", "```js\nold raw markdown"]) {
    it(`replacement discards pre-job tail ${prefix}`, async () => {
      const h = harness([message(prefix)], true)
      await flush()
      expect(mockSynthesize).not.toHaveBeenCalled()
      h.session.bubbles = [
        message("New content sentence that must be read without any old prefix."),
      ]
      h.session.turnState = "idle"
      await flush()
      const spoken = JSON.stringify(mockSynthesize.mock.calls)
      expect(spoken).toContain("New content")
      expect(spoken).not.toContain("old tail")
      expect(spoken).not.toContain("old raw")
    })
  }
  it("replacement resets larger processed count and repeated callID", async () => {
    const h = harness([message(LONG_TEXT, 3), tool()])
    await flush()
    const before = mockSynthesize.mock.calls.length
    expect(mockNarrate).toHaveBeenCalledTimes(1)
    h.session.bubbles = [
      message("New content should never be swallowed by an old segment count."),
      tool(),
    ]
    await flush()
    expect(mockSynthesize.mock.calls.length).toBeGreaterThan(before)
    expect(mockNarrate).toHaveBeenCalledTimes(2)
  })
  it("stop before effect discards old tail and marks only current content", async () => {
    const h = harness([message("old tail ")], true)
    await flush()
    h.session.bubbles = [message("new muted prefix")]
    h.speaker.stop()
    await flush()
    const b = h.session.bubbles[0] as MessageBubble
    b.segments.push({ id: "live", text: " A new live sentence that must play after stop." })
    h.session.turnState = "idle"
    await flush()
    expect(JSON.stringify(mockSynthesize.mock.calls)).toContain("new live sentence")
    expect(JSON.stringify(mockSynthesize.mock.calls)).not.toContain("old tail")
  })
  it("same-array same-IDs replacement rejects late translation", async () => {
    const gate = deferred<{ status: "translated"; text: string }>()
    vi.mocked(translate).mockReturnValueOnce(gate.promise as never)
    const h = harness([thought()])
    await flush()
    expect(translate).toHaveBeenCalledTimes(1)
    const sameArray = h.session.bubbles
    h.session.bubbles = sameArray
    gate.resolve({ status: "translated", text: "old translation" })
    await flush()
    const b = h.session.bubbles[0]
    expect(b?.kind === "thought" && b.segments[0]?.text).toBe(LONG_TEXT)
    expect(mockSynthesize).not.toHaveBeenCalled()
  })
  it("same IDs replacement rejects late tool narration but current job works", async () => {
    const gate = deferred<string | null>()
    mockNarrate.mockReturnValueOnce(gate.promise)
    const h = harness([tool()])
    await flush()
    expect(mockNarrate).toHaveBeenCalledTimes(1)
    h.session.bubbles = [tool()]
    await flush()
    gate.resolve("OLD NARRATION")
    await flush()
    const b = h.session.bubbles[0]
    expect(b?.kind === "tool" && b.toolCall.narration).toBe("Tool narration with enough text.")
    expect(JSON.stringify(mockSynthesize.mock.calls)).not.toContain("OLD NARRATION")
  })
  it("old settlement cannot decrement new queue reservation", async () => {
    const old = deferred<ReadableStream<Uint8Array>>()
    const fresh = deferred<ReadableStream<Uint8Array>>()
    mockSynthesize.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    const h = harness([message(LONG_TEXT)])
    await flush()
    expect(mockSynthesize).toHaveBeenCalledTimes(1)
    h.speaker.stop()
    h.session.bubbles = [message("A fresh sentence that has a different active queue reservation.")]
    await flush()
    expect(mockSynthesize).toHaveBeenCalledTimes(2)
    expect(h.speaker.hasPendingNarration).toBe(true)
    old.resolve(new ReadableStream())
    await flush()
    expect(h.speaker.hasPendingNarration).toBe(true)
    fresh.resolve(new ReadableStream())
    await flush()
    expect(h.speaker.hasPendingNarration).toBe(false)
    expect(h.speaker.debugInfo().inFlight).toBe(0)
  })
})

describe("captured fetch attempts", () => {
  for (const oldResult of ["success", "reject", "null"] as const)
    for (const oldFirst of [true, false]) {
      it(`refetch isolates old ${oldResult}, oldFirst=${oldFirst}`, async () => {
        const a = deferred<string | null>(),
          b = deferred<string | null>()
        mockNarrate.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
        const h = harness([tool()])
        await flush()
        expect(mockNarrate).toHaveBeenCalledTimes(1)
        const id = h.playlist.items[0]!.segmentId
        const oldSignal = mockNarrate.mock.calls[0]![3] as AbortSignal
        h.speaker.invalidate(id)
        h.speaker.refetch(id)
        await flush()
        expect(mockNarrate).toHaveBeenCalledTimes(2)
        const signal = mockNarrate.mock.calls[1]![3] as AbortSignal
        expect(oldSignal.aborted).toBe(true)
        expect(signal.aborted).toBe(false)
        const abandoned = vi.spyOn(h.playlist, "markAbandoned"),
          errors = vi.spyOn(h.playlist, "markError")
        const finishA = async () => {
          if (oldResult === "reject") a.reject(new Error("old error"))
          else a.resolve(oldResult === "null" ? null : "OLD RESULT")
          await flush()
        }
        if (oldFirst) await finishA()
        b.resolve("New narration remains valid after refetch.")
        await flush()
        if (!oldFirst) await finishA()
        const bubble = h.session.bubbles[0]
        expect(bubble?.kind === "tool" && bubble.toolCall.narration).toBe(
          "New narration remains valid after refetch.",
        )
        expect(signal.aborted).toBe(false)
        expect(abandoned).not.toHaveBeenCalled()
        expect(errors).not.toHaveBeenCalled()
        expect(JSON.stringify(mockSynthesize.mock.calls)).not.toContain("OLD RESULT")
        expect(h.speaker.hasPendingNarration).toBe(false)
        expect(h.speaker.debugInfo().inFlight).toBe(0)
      })
    }
  it("hash await cannot start stale provider; next content still works", async () => {
    const hash = deferred<string>()
    vi.mocked(cacheKeyFor).mockReturnValueOnce(hash.promise)
    const h = harness([message(LONG_TEXT)])
    await flush()
    expect(cacheKeyFor).toHaveBeenCalled()
    expect(mockSynthesize).not.toHaveBeenCalled()
    h.session.bubbles = [
      message("Fresh content after hashing delay must still reach the speech provider."),
    ]
    await flush()
    expect(mockSynthesize).toHaveBeenCalledTimes(1)
    hash.resolve("old-hash")
    await flush()
    expect(mockSynthesize).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(mockSynthesize.mock.calls)).toContain("Fresh content")
  })
  it("stale provider stream is cancelled once and never prepared", async () => {
    const provider = deferred<ReadableStream<Uint8Array>>()
    mockSynthesize.mockReturnValueOnce(provider.promise)
    const h = harness([message(LONG_TEXT)])
    await flush()
    expect(mockSynthesize).toHaveBeenCalledTimes(1)
    h.session.bubbles = []
    await flush()
    const cancel = vi.fn()
    provider.resolve(new ReadableStream({ cancel }))
    await flush()
    expect(cancel).toHaveBeenCalledOnce()
    expect(h.prepared).toHaveLength(0)
    expect(h.speaker.debugInfo().inFlight).toBe(0)
  })
  it("late prepare cannot mark a replaced reservation ready", async () => {
    const prepare = deferred<void>()
    const h = harness([message(LONG_TEXT)])
    const entered = vi.fn()
    h.sink.prepareSegment = async () => {
      entered()
      await prepare.promise
    }
    const ready = vi.spyOn(h.playlist, "markReady")
    await flush()
    expect(entered).toHaveBeenCalledOnce()
    h.session.bubbles = []
    await flush()
    prepare.resolve()
    await flush()
    expect(ready).not.toHaveBeenCalled()
    expect(h.speaker.debugInfo().inFlight).toBe(0)
  })
  it("tool kind mismatch refuses annotation but allows valid speech", async () => {
    const gate = deferred<string | null>()
    mockNarrate.mockReturnValueOnce(gate.promise)
    const h = harness([tool()])
    await flush()
    expect(mockNarrate).toHaveBeenCalledOnce()
    const bubble = h.session.bubbles[0]
    if (bubble?.kind !== "tool") throw Error("tool missing")
    bubble.toolCall.kind = "read"
    gate.resolve("Valid speech with no stale tool annotation.")
    await flush()
    const current = h.session.bubbles[0]
    expect(current?.kind === "tool" ? current.toolCall.narration : "wrong kind").toBeUndefined()
    expect(mockSynthesize).toHaveBeenCalledOnce()
  })
  it("thought source exact mismatch refuses annotation but allows valid speech", async () => {
    const gate = deferred<{ status: "translated"; text: string }>()
    vi.mocked(translate).mockReturnValueOnce(gate.promise as never)
    const h = harness([thought()])
    await flush()
    expect(translate).toHaveBeenCalledOnce()
    const bubble = h.session.bubbles[0]
    if (bubble?.kind !== "thought") throw Error("thought missing")
    bubble.segments[0]!.text += " extension"
    gate.resolve({ status: "translated", text: "Valid translation speech" })
    await flush()
    const current = h.session.bubbles[0]
    expect(
      current?.kind === "thought" ? current.segments[0]?.originalText : "wrong kind",
    ).toBeUndefined()
    expect(mockSynthesize).toHaveBeenCalledOnce()
  })
})

it("stop before effect resets repeated tool IDs for current content", async () => {
  const h = harness([tool()])
  await flush()
  expect(mockNarrate).toHaveBeenCalledOnce()
  h.session.bubbles = [tool()]
  h.speaker.stop()
  await flush()
  expect(mockNarrate).toHaveBeenCalledTimes(2)
})

it("historical mark A before first effect does not mute replacement B", async () => {
  const state = {
    ...createInitialSessionState({ sessionId: "history" }),
    version: 1,
    messages: [
      {
        id: "m_0",
        role: "assistant" as const,
        messageId: "msg",
        segments: [
          { id: "s0", text: LONG_TEXT },
          { id: "s1", text: LONG_TEXT },
        ],
      },
    ],
    nextMessageSeq: 1,
    nextSegmentSeq: 2,
  }
  const view = new RemoteSessionView("history", "http://synthetic", {
    _fetch: async () =>
      ({
        ok: true,
        status: 200,
        body: new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(
              new TextEncoder().encode(
                serializeFrame(
                  snapshotFrame(state, undefined, { hostIncarnation: "fixture-host" }),
                ),
              ),
            )
          },
        }),
      }) as Response,
  })
  const session = new AgentSession({ view })
  await view.connect()
  await flush()
  expect(session.historyEpoch).toBe(1)
  const h = harness(undefined, false, session)
  h.session.bubbles = [
    {
      id: "m_0",
      kind: "message",
      messageId: "msg",
      createdAt: 0,
      segments: [
        { id: "s0", text: "Live replacement B should not inherit a historical mark from A." },
      ],
    },
  ]
  await flush()
  expect(mockSynthesize).toHaveBeenCalledOnce()
  await view.close()
})

it("thought completions advance in accepted completion order", async () => {
  const a = deferred<{ status: "translated"; text: string }>(),
    b = deferred<{ status: "translated"; text: string }>()
  vi.mocked(translate)
    .mockReturnValueOnce(a.promise as never)
    .mockReturnValueOnce(b.promise as never)
  const bubble = thought()
  if (bubble.kind !== "thought") throw Error("thought missing")
  bubble.segments.push({
    id: "s2",
    text: " A second thought sentence that is long enough to translate separately.",
  })
  const h = harness([bubble])
  await flush()
  expect(translate).toHaveBeenCalledTimes(2)
  b.resolve({ status: "translated", text: "Second completion accepted first" })
  await flush()
  a.resolve({ status: "translated", text: "First completion accepted second" })
  await flush()
  const current = h.session.bubbles[0]
  expect(current?.kind === "thought" && current.segments.map((s) => s.text)).toEqual([
    "Second completion accepted first",
    "First completion accepted second",
  ])
})

it("hash await also rejects a replaced attempt within the same content", async () => {
  const hash = deferred<string>()
  vi.mocked(cacheKeyFor).mockReturnValueOnce(hash.promise)
  const h = harness([message(LONG_TEXT)])
  await flush()
  expect(cacheKeyFor).toHaveBeenCalled()
  expect(mockSynthesize).not.toHaveBeenCalled()
  const id = h.playlist.items[0]!.segmentId
  h.speaker.invalidate(id)
  h.speaker.refetch(id)
  await flush()
  expect(mockSynthesize).toHaveBeenCalledOnce()
  hash.resolve("old-attempt")
  await flush()
  expect(mockSynthesize).toHaveBeenCalledOnce()
  expect(h.speaker.debugInfo().inFlight).toBe(0)
  expect(h.speaker.hasPendingNarration).toBe(false)
})

it("thought segment ID mismatch rejects annotation without cancelling current speech", async () => {
  const gate = deferred<{ status: "translated"; text: string }>()
  vi.mocked(translate).mockReturnValueOnce(gate.promise as never)
  const h = harness([thought()])
  await flush()
  expect(translate).toHaveBeenCalledOnce()
  const b = h.session.bubbles[0]
  if (b?.kind !== "thought") throw Error("missing thought")
  b.segments[0]!.id = "replacement-segment"
  gate.resolve({ status: "translated", text: "Valid speech without a stale segment annotation" })
  await flush()
  const current = h.session.bubbles[0]
  expect(current?.kind === "thought" ? current.segments[0]?.text : "wrong kind").toBe(LONG_TEXT)
  expect(mockSynthesize).toHaveBeenCalledOnce()
})

it("rejected annotation does not advance the completion counter", async () => {
  const a = deferred<{ status: "translated"; text: string }>(),
    b = deferred<{ status: "translated"; text: string }>()
  vi.mocked(translate)
    .mockReturnValueOnce(a.promise as never)
    .mockReturnValueOnce(b.promise as never)
  const initial = thought()
  if (initial.kind !== "thought") throw Error("missing thought")
  initial.segments.push({
    id: "second",
    text: " A second thought sentence that starts another translation job.",
  })
  const h = harness([initial])
  await flush()
  expect(translate).toHaveBeenCalledTimes(2)
  const bubble = h.session.bubbles[0]
  if (bubble?.kind !== "thought") throw Error("missing thought")
  const id = bubble.segments[0]!.id
  bubble.segments[0]!.id = "mismatch"
  a.resolve({ status: "translated", text: "rejected annotation" })
  await flush()
  let current = h.session.bubbles[0]
  expect(current?.kind === "thought" && current.segments[0]?.text).toBe(LONG_TEXT)
  if (current?.kind !== "thought") throw Error("missing thought")
  current.segments[0]!.id = id
  b.resolve({ status: "translated", text: "accepted at index zero" })
  await flush()
  current = h.session.bubbles[0]
  expect(current?.kind === "thought" && current.segments[0]?.text).toBe("accepted at index zero")
  expect(mockSynthesize).toHaveBeenCalledTimes(2)
})
