/**
 * @vitest-environment jsdom
 * speaker.test.svelte.ts — TDD ל-Commit 0: FetchOutcome + markAbandoned.
 */

import { OrderAllocator } from "@drive-coding/core/voice/tts-queue"
import { tick } from "svelte"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AudioPlaylist } from "$lib/engines/audio-playlist.svelte"
import type { AudioSink } from "$lib/engines/audio-sink"
import type { MessageBubble } from "$lib/types/bubble"
import type { AgentSession, AgentSessionStatus, TurnState } from "./agent-session.svelte"
import { Settings } from "./settings.svelte"
import { Speaker } from "./speaker.svelte"

const mockSynthesize = vi.fn()
const mockIsAvailable = vi.fn(() => true)
const mockNarrate = vi.fn()

vi.mock("$lib/adapters/voice/tts-resolve", () => ({
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
      isAvailable: (...args: unknown[]) => mockIsAvailable(...args),
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

let sessionBubbles = $state<MessageBubble[]>([])

function makeSession(extra?: Partial<AgentSession>): AgentSession {
  return {
    get bubbles() {
      return sessionBubbles
    },
    status: "idle" as AgentSessionStatus,
    turnState: "idle" as TurnState,
    isLoadingHistory: false,
    ...extra,
  } as AgentSession
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

type Harness = {
  speaker: Speaker
  playlist: AudioPlaylist
  sink: ReturnType<typeof makeMockSink>
  destroy: () => void
}

function createHarness(initial?: MessageBubble[], extraSession?: Partial<AgentSession>): Harness {
  sessionBubbles = initial ?? []
  const settings = new Settings()
  settings.ttsProvider = "google"
  settings.narrateTools = true
  const sink = makeMockSink()
  const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: 5000 })
  const speaker = new Speaker({
    session: makeSession(extraSession),
    settings,
    playlist,
    audioStream: sink,
    orderAlloc: new OrderAllocator(),
  })
  return { speaker, playlist, sink, destroy: () => speaker.destroy() }
}

async function flush(rounds = 24): Promise<void> {
  for (let i = 0; i < rounds; i++) await tick()
}

const messageBubble = (text: string): MessageBubble => ({
  id: "bubble-1",
  kind: "message",
  messageId: "msg-1",
  createdAt: Date.now(),
  segments: [{ id: "seg-1", text }],
})

let active: Harness | null = null

beforeEach(() => {
  vi.clearAllMocks()
  localStorageMock.clear()
  mockIsAvailable.mockReturnValue(true)
  mockSynthesize.mockImplementation(async () => new ReadableStream<Uint8Array>())
})

afterEach(() => {
  active?.destroy()
  active = null
})

describe("Speaker.#fetchJob — FetchOutcome (commit 0)", () => {
  it("provider unavailable → error → item skipped immediately", async () => {
    mockIsAvailable.mockReturnValue(false)
    active = createHarness([messageBubble(LONG_TEXT)])
    await flush()
    const item = active.playlist.items[0]
    expect(item).toBeDefined()
    expect(item?.state).toBe("error")
  })

  it("job.abort → abandoned → item stays reserved (not error)", async () => {
    active = createHarness([messageBubble(LONG_TEXT)])
    const originalPrepare = active.sink.prepareSegment.bind(active.sink)
    active.sink.prepareSegment = async (segmentId, stream, ac, opts) => {
      await new Promise<void>((resolve) => {
        ac.signal.addEventListener("abort", () => resolve(), { once: true })
      })
      await originalPrepare(segmentId, stream, ac, opts)
    }

    await flush()
    const segId = active.playlist.items[0]?.segmentId
    expect(segId).toBeDefined()

    active.playlist.reserve("s1", { seq: 1, segmentIndex: 0 }, "bubble-2")
    active.playlist.next()
    await flush()

    const item = active.playlist.items.find((it) => it.segmentId === segId)
    expect(item?.state).toBe("reserved")
    expect(item?.state).not.toBe("error")
  })

  it("narration null (tool) → error → skipped", async () => {
    mockNarrate.mockResolvedValue(null)
    active = createHarness(
      [
        {
          id: "tool-bubble",
          kind: "tool",
          messageId: null,
          createdAt: Date.now(),
          toolCall: {
            toolCallId: "tc-1",
            kind: "other",
            status: "completed",
            title: "run",
          },
          segments: [],
        },
      ],
      { lastUserMessage: "hi", recentAssistantMessages: () => [] },
    )
    await flush()
    const item = active.playlist.items[0]
    expect(item).toBeDefined()
    expect(item?.state).toBe("error")
    expect(mockSynthesize).not.toHaveBeenCalled()
  })

  it("happy path → ready exactly once", async () => {
    const markReadySpy = vi.spyOn(AudioPlaylist.prototype, "markReady")
    active = createHarness([messageBubble(LONG_TEXT)])
    await flush()
    expect(markReadySpy).toHaveBeenCalledTimes(1)
    expect(active.sink.prepared.size).toBe(1)
    const item = active.playlist.items[0]
    expect(item?.state).not.toBe("error")
    markReadySpy.mockRestore()
  })
})

// ─── רגרסיות מ-code review (2026-08-21) ────────────────────────────────
describe("Speaker — invalidate/refetch", () => {
  // 🔴 שני כשלים **מנוגדים** באותה נקודה, ולכן שני קיבועים:
  //
  //  (א) `invalidate` לא הוריד `ready` → refetch נחסם → הפלייליסט המתין
  //      20 שניות ואז `skipped`. משפט נעלם אחרי המתנה ארוכה.
  //  (ב) התיקון הראשון שלי התיר refetch ל-`ready` — והפלייליסט קורא
  //      `refetch` יותר מפעם אחת, אז `markReady` נקרא **5 פעמים**.
  //
  // הכלל: `invalidate` מוריד ל-`stale`; `refetch` לא נוגע ב-`ready`.
  it("job מוכן שלא בוטל — refetch אינו יוצר fetch נוסף", async () => {
    const spy = vi.spyOn(AudioPlaylist.prototype, "markReady")
    active = createHarness([messageBubble(LONG_TEXT)])
    await flush()
    const before = spy.mock.calls.length
    active.speaker.refetch(active.playlist.items[0]!.segmentId)
    await flush()
    expect(spy.mock.calls.length).toBe(before)
    spy.mockRestore()
  })

  it("אחרי invalidate — refetch כן יוצר fetch חדש", async () => {
    const spy = vi.spyOn(AudioPlaylist.prototype, "markReady")
    active = createHarness([messageBubble(LONG_TEXT)])
    await flush()
    const id = active.playlist.items[0]!.segmentId
    const before = spy.mock.calls.length
    active.speaker.invalidate(id)
    active.speaker.refetch(id)
    await flush()
    expect(spy.mock.calls.length).toBeGreaterThan(before)
    spy.mockRestore()
  })
})
