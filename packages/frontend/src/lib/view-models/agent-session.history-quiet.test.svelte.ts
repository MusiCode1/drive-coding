/**
 * @vitest-environment jsdom
 * agent-session.history-quiet.test.svelte.ts — רתמת replay-quiet.
 *
 * מחבר: תעבורת SSE (per-frame) → RemoteSessionView → AgentSession → Speaker אמיתי.
 * ─── slice replay-quiet Commit 1 ───
 */

import {
  createInitialSessionState,
  messageWireByteSize,
  type Patch,
  reduce,
  type SessionState,
  selectRange,
  serializeFrame,
  snapshotPayload,
  updateFrame,
} from "@drive-coding/core/session"
import { type IntentFrame, toWireFrames } from "@drive-coding/core/session/testing"
import { splitIntoSentences } from "@drive-coding/core/voice/sentence-boundary"
import {
  type SpeakableLabels,
  splitStreamable,
  toSpeakable,
} from "@drive-coding/core/voice/speakable"
import { OrderAllocator } from "@drive-coding/core/voice/tts-queue"
import { tick } from "svelte"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AudioPlaylist } from "$lib/engines/audio-playlist.svelte"
import type { AudioSink } from "$lib/engines/audio-sink"
import { createRemoteSessionView } from "$lib/session/create-session-view.js"
import type { RemoteSessionView } from "$lib/session/remote-session-view.js"
import {
  historyTailResponse,
  metaSnapshotFrame,
  withHistoryTail,
} from "./__fixtures__/meta-history-fetch"
import { AgentSession } from "./agent-session.svelte.js"
import { Settings } from "./settings.svelte"
import { Speaker } from "./speaker.svelte"

const mockSynthesize = vi.fn()
// params declared so the spread into it typechecks against the real
// `isAvailable(provider)` signature on ttsCapabilities
const mockIsAvailable = vi.fn((_provider: "elevenlabs" | "google") => true)
const mockNarrate = vi.fn()

// Keep the module's real exports (settings-persistence imports its default model ids) and
// replace only resolveTts — a factory with resolveTts alone crashed the import chain.
vi.mock("$lib/adapters/voice/tts-resolve", async (importOriginal) => ({
  ...(await importOriginal<typeof import("$lib/adapters/voice/tts-resolve")>()),
  resolveTts: vi.fn(() => ({
    provider: {
      format: "pcm" as const,
      synthesize: (...args: unknown[]) => mockSynthesize(...args),
    },
    voiceId: "voice",
    modelId: "model",
  })),
}))

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

const encoder = new TextEncoder()
const noSleep = (): Promise<void> => Promise.resolve()
const MIN_CHARS = 20
const MAX_CHARS = 200

/** Measured on unfixed code before Commit 2 — reconnect anti-regression baseline. */
const RECONNECT_ENQUEUE_BASELINE = 1

const SPEAKABLE_LABELS: SpeakableLabels = {
  codeBlock: "code block",
  codeBlockWithLang: (lang: string) => `code block ${lang}`,
  link: "link",
  image: "image",
}

const SENTENCES = Array.from(
  { length: 8 },
  (_, i) => `Historical sentence number ${i + 1} with enough characters here.`,
)

export const HISTORY_TEXT = SENTENCES.join(" ")

function historicalMessage(segmentCount = 8) {
  return {
    id: "m_0",
    role: "assistant" as const,
    messageId: "prov-hist",
    segments: SENTENCES.slice(0, segmentCount).map((text, i) => ({
      id: `s_${i}`,
      text: i === 0 ? text : ` ${text}`,
    })),
  }
}

export function sentencesForFixture(text: string): string[] {
  const { ready, held } = splitStreamable(text)
  const speakPending =
    toSpeakable(ready, SPEAKABLE_LABELS, { stream: true }) +
    toSpeakable(held, SPEAKABLE_LABELS, { stream: true })
  const { sentences } = splitIntoSentences(speakPending.trim(), {
    minChars: MIN_CHARS,
    maxChars: MAX_CHARS,
  })
  return sentences
}

function makeSnapshot(overrides: Partial<SessionState> = {}): SessionState {
  return { ...createInitialSessionState({ sessionId: "quiet-sess-1" }), ...overrides }
}

/** `Omit<Union, K>` collapses the union to its shared keys — distribute instead. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

function makePatch(version: number, body: DistributiveOmit<Patch, "version">): Patch {
  return { version, ...body } as Patch
}

/**
 * Per-frame SSE — macrotask between frames so $effect flushes like a browser.
 */
function sseBodyPerFrame(
  frames: IntentFrame[],
  opts: { keepOpen?: boolean } = {},
): ReadableStream<Uint8Array> {
  const { keepOpen = true } = opts
  const wireChunks = toWireFrames(frames).map(serializeFrame)
  return new ReadableStream({
    async start(ctrl) {
      for (const chunk of wireChunks) {
        ctrl.enqueue(encoder.encode(chunk))
        await new Promise<void>((r) => setTimeout(r, 0))
      }
      if (!keepOpen) ctrl.close()
    },
  })
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response
}

function makeMockFetch(
  frameSets: IntentFrame[][],
  opts: { keepOpenLast?: boolean } = {},
): (url: string, init?: RequestInit) => Promise<Response> {
  let call = 0
  const { keepOpenLast = true } = opts
  return vi.fn().mockImplementation(async (url: string) => {
    if (url.includes("/events")) {
      const idx = call++
      const frames = frameSets[idx] ?? frameSets[frameSets.length - 1] ?? []
      const isLastProvided = idx >= frameSets.length - 1
      return {
        ok: true,
        status: 200,
        body: sseBodyPerFrame(frames, { keepOpen: isLastProvided ? keepOpenLast : false }),
      } as unknown as Response
    }
    if (url.includes("/rpc")) {
      return jsonResponse({ version: 1 }, 202)
    }
    if (url.includes("/reply")) {
      return jsonResponse({ ok: true }, 200)
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
}

function makeMockSink(): AudioSink & { prepared: Set<string> } {
  const prepared = new Set<string>()
  return {
    prepared,
    prepareSegment: async (segmentId: string) => {
      prepared.add(segmentId)
    },
    play: async () => {},
    cancel: () => {},
    clear: () => prepared.clear(),
    pause: () => {},
    resume: () => {},
    isComplete: () => false,
  }
}

type QuietHarness = {
  agent: AgentSession
  speaker: Speaker
  view: RemoteSessionView
  enqueueCount: () => number
  destroy: () => void
}

const activeViews: RemoteSessionView[] = []

async function flushEffects(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) await tick()
  await new Promise<void>((r) => setTimeout(r, 0))
}

function wrapMetaFetch(
  fullState: SessionState,
  frameSets: IntentFrame[][],
  opts?: { keepOpenLast?: boolean },
): (url: string, init?: RequestInit) => Promise<Response> {
  const base = makeMockFetch(frameSets, opts)
  return withHistoryTail("http://be.local", fullState, base, { history: "omit" })
}

function createQuietHarness(
  frames: IntentFrame[],
  mockFetch?: (url: string, init?: RequestInit) => Promise<Response>,
): QuietHarness {
  const fetchImpl = mockFetch ?? makeMockFetch([frames])
  const view = createRemoteSessionView("agent-quiet", "http://be.local", {
    _fetch: fetchImpl,
    _sleep: noSleep,
  })
  activeViews.push(view)

  const settings = new Settings()
  settings.ttsProvider = "google"
  settings.muted = false

  const sink = makeMockSink()
  const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })
  let enqueues = 0
  const origReserve = playlist.reserve.bind(playlist)
  vi.spyOn(playlist, "reserve").mockImplementation((...args) => {
    enqueues += 1
    return origReserve(...args)
  })

  const agent = new AgentSession({ view, settings })
  const speaker = new Speaker({
    session: agent,
    settings,
    playlist,
    audioStream: sink,
    orderAlloc: new OrderAllocator(),
  })

  return {
    agent,
    speaker,
    view,
    enqueueCount: () => enqueues,
    destroy: () => {
      speaker.destroy()
      view.close()
    },
  }
}

beforeEach(() => {
  mockSynthesize.mockReset()
  mockIsAvailable.mockReturnValue(true)
  mockNarrate.mockReset()
})

afterEach(() => {
  for (const v of activeViews) v.close()
  activeViews.length = 0
})

describe("replay-quiet harness", () => {
  it("fixture sanity — the historical text yields exactly 8 sentences", () => {
    expect(sentencesForFixture(HISTORY_TEXT).length).toBe(8)
  })

  it("א — attach with history: historical content must not enqueue (0 after fix)", async () => {
    const snapshot = makeSnapshot({
      version: 505,
      messages: [historicalMessage()],
      turnState: "idle",
      nextMessageSeq: 1,
      nextSegmentSeq: 8,
    })
    const frames: IntentFrame[] = [{ event: "snapshot", data: JSON.stringify(snapshot) }]
    const harness = createQuietHarness(frames)

    await harness.view.connect()
    await flushEffects()

    expect(harness.enqueueCount()).toBe(0)
    harness.destroy()
  })

  it("ב — new content after attach still enqueues", async () => {
    const snapshot = makeSnapshot({
      version: 1,
      messages: [historicalMessage()],
      turnState: "idle",
    })
    const livePatch = makePatch(2, {
      op: "append-segment",
      targetId: "m_0",
      segment: {
        id: "s_live",
        text: " Brand new live sentence with enough characters here.",
      },
    })
    const frames: IntentFrame[] = [
      { event: "snapshot", data: JSON.stringify(snapshot) },
      { event: "patch", data: JSON.stringify(livePatch) },
    ]
    const harness = createQuietHarness(frames)

    await harness.view.connect()
    for (let i = 0; i < 20; i++) {
      await new Promise<void>((r) => setTimeout(r, 20))
      await tick()
      if (harness.enqueueCount() > 0) break
    }

    expect(harness.enqueueCount()).toBeGreaterThan(0)
    harness.destroy()
  })

  it("ג — attach mid-turn: only segments after the cut enqueue", async () => {
    const snapshot = makeSnapshot({
      version: 10,
      messages: [historicalMessage(4)],
      turnState: "waiting",
      nextMessageSeq: 1,
      nextSegmentSeq: 4,
    })
    const patches = SENTENCES.slice(4).map((text, i) =>
      makePatch(11 + i, {
        op: "append-segment",
        targetId: "m_0",
        segment: { id: `s_${4 + i}`, text: i === 0 ? text : ` ${text}` },
      }),
    )
    const frames: IntentFrame[] = [
      { event: "snapshot", data: JSON.stringify(snapshot) },
      ...patches.map((p) => ({ event: "patch", data: JSON.stringify(p) })),
    ]
    const harness = createQuietHarness(frames)

    await harness.view.connect()
    for (let i = 0; i < 30; i++) {
      await new Promise<void>((r) => setTimeout(r, 20))
      await tick()
      if (harness.enqueueCount() >= 4) break
    }

    expect(harness.enqueueCount()).toBe(4)
    harness.destroy()
  })

  it("ד — two consecutive attaches: no leak from the first attach", async () => {
    const snapshot = makeSnapshot({
      version: 505,
      messages: [historicalMessage()],
      turnState: "idle",
    })
    const frames: IntentFrame[] = [{ event: "snapshot", data: JSON.stringify(snapshot) }]

    const harness1 = createQuietHarness(frames)
    await harness1.view.connect()
    await flushEffects()
    harness1.destroy()

    const harness2 = createQuietHarness(frames)
    await harness2.view.connect()
    await flushEffects()

    expect(harness2.enqueueCount()).toBe(0)
    harness2.destroy()
  })

  it("ה — SSE reconnect mid-turn: enqueue count unchanged by history-mark fix", async () => {
    const snapshot1 = makeSnapshot({
      version: 1,
      messages: [
        {
          id: "m_0",
          role: "assistant" as const,
          messageId: "p1",
          segments: [],
        },
      ],
      turnState: "idle",
    })
    const patch1 = makePatch(2, {
      op: "append-segment",
      targetId: "m_0",
      segment: { id: "s_0", text: "Live chunk one with enough characters." },
    })
    const snapshot2 = makeSnapshot({
      version: 5,
      messages: [
        {
          id: "m_0",
          role: "assistant" as const,
          messageId: "p1",
          segments: [
            { id: "s_0", text: "Live chunk one with enough characters." },
            { id: "s_1", text: " Live chunk two with enough characters." },
          ],
        },
      ],
      turnState: "waiting",
      nextSegmentSeq: 2,
    })

    const mockFetch = makeMockFetch(
      [
        [
          {
            event: "snapshot",
            data: JSON.stringify({
              ...snapshot1,
              messages: [
                {
                  id: "m_0",
                  role: "assistant" as const,
                  messageId: "p1",
                  segments: [],
                },
              ],
            }),
          },
          { event: "patch", data: JSON.stringify(patch1) },
        ],
        [{ event: "snapshot", data: JSON.stringify(snapshot2) }],
      ],
      { keepOpenLast: true },
    )

    const harness = createQuietHarness([], mockFetch)
    await harness.view.connect()
    for (let i = 0; i < 30; i++) {
      await new Promise<void>((r) => setTimeout(r, 20))
      await tick()
      if (harness.enqueueCount() >= RECONNECT_ENQUEUE_BASELINE) break
    }
    expect(harness.enqueueCount()).toBe(RECONNECT_ENQUEUE_BASELINE)
    harness.destroy()
  })
})

describe("replay-quiet meta path", () => {
  it("meta א — tail from /history must not enqueue", async () => {
    const fullState = makeSnapshot({
      version: 505,
      messages: [historicalMessage()],
      turnState: "idle",
      nextMessageSeq: 1,
      nextSegmentSeq: 8,
    })
    const opening = metaSnapshotFrame(fullState)
    const mockFetch = wrapMetaFetch(fullState, [
      [{ event: "snapshot", data: opening.data as string }],
    ])
    const harness = createQuietHarness([], mockFetch)

    await harness.view.connect()
    await flushEffects(16)

    expect(harness.enqueueCount()).toBe(0)
    harness.destroy()
  })

  it("meta ד — second meta attach does not re-enqueue tail", async () => {
    const fullState = makeSnapshot({
      version: 505,
      messages: [historicalMessage()],
      turnState: "idle",
    })
    const opening = metaSnapshotFrame(fullState)
    const frame = [{ event: "snapshot", data: opening.data as string }]
    const mockFetch = () => wrapMetaFetch(fullState, [frame])

    const harness1 = createQuietHarness([], mockFetch())
    await harness1.view.connect()
    await flushEffects(16)
    harness1.destroy()

    const harness2 = createQuietHarness([], mockFetch())
    await harness2.view.connect()
    await flushEffects(16)
    expect(harness2.enqueueCount()).toBe(0)
    harness2.destroy()
  })

  it("keeps a visible tail and the prepended history quiet", async () => {
    const older = historicalMessage()
    const newest = { ...older, id: "m_1", messageId: "newest" }
    const fullState = makeSnapshot({ version: 505, messages: [older, newest] })
    const opening = metaSnapshotFrame(fullState)
    const base = makeMockFetch([[{ event: "snapshot", data: opening.data }]])
    const harness = createQuietHarness([], async (url, init) => {
      const { pathname, searchParams } = new URL(url)
      if (pathname.endsWith("/history")) {
        const range = searchParams.has("tail")
          ? { tail: true as const, maxBytes: 1 }
          : { before: Number(searchParams.get("before")), maxBytes: 1 }
        return jsonResponse(snapshotPayload(fullState, undefined, { range }))
      }
      return base(url, init)
    })
    try {
      await harness.view.connect()
      await flushEffects()
      expect(harness.agent.bubbles).toHaveLength(1)
      expect(harness.enqueueCount()).toBe(0)
      await harness.view.history.loadOlder()
      await flushEffects()
      expect(harness.agent.bubbles.map(({ id }) => id)).toEqual(["m_0", "m_1"])
      expect(harness.enqueueCount()).toBe(0)
    } finally {
      harness.destroy()
    }
  })

  it("shows a tool from earlier history with the status received during its GET", async () => {
    let state = reduce(makeSnapshot(), {
      sessionUpdate: "tool_call",
      toolCallId: "earlier-tool",
      title: "Earlier tool",
      status: "in_progress",
    }).state
    state = reduce(state, {
      sessionUpdate: "user_message",
      messageId: "visible",
      content: { type: "text", text: "Visible tail" },
    }).state
    const completed = reduce(state, {
      sessionUpdate: "tool_call_update",
      toolCallId: "earlier-tool",
      status: "completed",
    })
    const patch = completed.patches[0]
    if (!patch) throw new Error("Missing tool status patch")
    const live = updateFrame(completed.state, patch, "meta")
    if (!live) throw new Error("Missing tool status update")
    const opening = metaSnapshotFrame(state)
    const pending = Promise.withResolvers<Response>()
    let stream: ReadableStreamDefaultController<Uint8Array> | undefined
    const encoder = new TextEncoder()
    const harness = createQuietHarness([], async (url) => {
      const { pathname, searchParams } = new URL(url)
      if (pathname.endsWith("/events")) {
        return new Response(
          new ReadableStream({
            start(controller) {
              stream = controller
              controller.enqueue(encoder.encode(serializeFrame(opening)))
            },
          }),
        )
      }
      if (searchParams.has("before")) return pending.promise
      return jsonResponse(snapshotPayload(state, undefined, { range: { tail: true, maxBytes: 1 } }))
    })
    try {
      await harness.view.connect()
      const loading = harness.view.history.loadOlder()
      await vi.waitFor(() => expect(harness.view.history.loadingOlder).toBe(true))
      stream?.enqueue(encoder.encode(serializeFrame(live)))
      await vi.waitFor(() => expect(harness.view.state.version).toBe(completed.state.version))
      pending.resolve(
        jsonResponse(snapshotPayload(state, undefined, { range: { before: 1, maxBytes: 1 } })),
      )
      await loading
      await vi.waitFor(() => {
        const first = harness.agent.bubbles[0]
        expect(first?.kind === "tool" && first.toolCall.status).toBe("completed")
      })
    } finally {
      harness.destroy()
    }
  })

  it.each([false, true])(
    "speaks only reconnect additions within the same session (replacement=%s)",
    async (replacement) => {
      const first = makeSnapshot({
        version: 200,
        messages: [historicalMessage(1)],
        turnState: "responding",
      })
      const next = makeSnapshot({
        sessionId: replacement ? "replacement" : first.sessionId,
        version: 201,
        messages: [
          historicalMessage(1),
          {
            id: "m_1",
            role: "assistant",
            messageId: "new-response",
            segments: [{ id: "s_8", text: "A new sentence is ready to hear after reconnect." }],
          },
        ],
        turnState: "responding",
      })
      let requests = 0
      const base = makeMockFetch(
        [first, next].map((state) => [{ event: "snapshot", data: metaSnapshotFrame(state).data }]),
      )
      const harness = createQuietHarness([], async (url, init) => {
        if (new URL(url).pathname.endsWith("/history"))
          return jsonResponse(historyTailResponse(requests++ === 0 ? first : next))
        return base(url, init)
      })
      try {
        await harness.view.connect()
        await vi.waitFor(() => expect(harness.agent.bubbles).toHaveLength(2))
        await flushEffects(16)
        expect(harness.enqueueCount()).toBe(replacement ? 0 : 1)
      } finally {
        harness.destroy()
      }
    },
  )

  it("meta — oversized session tail marks hasMore (HistoryEdge signal)", () => {
    const fullState = makeSnapshot({
      version: 20,
      messages: Array.from({ length: 48 }, (_, i) => ({
        id: `m_${i}`,
        role: "assistant" as const,
        messageId: `p-${i}`,
        segments: [{ id: `s_${i}`, text: "x".repeat(8_000) }],
      })),
      turnState: "idle",
      nextMessageSeq: 48,
      nextSegmentSeq: 48,
    })
    const sized = selectRange(fullState, { tail: true, maxBytes: 262_144 }, messageWireByteSize)
    expect(sized.ok && sized.page?.hasMore).toBe(true)
    const tail = historyTailResponse(fullState)
    expect(tail.page?.hasMore).toBe(true)
  })
})
