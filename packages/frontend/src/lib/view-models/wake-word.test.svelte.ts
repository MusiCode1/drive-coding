/**
 * wake-word.test.svelte.ts — integration tests ל-WakeWordVM עם mock engine.
 *
 * מכסה: mode transitions, flashCount, capture start/stop.
 * אין getUserMedia / AudioContext.
 */

import { beforeEach, describe, expect, test, vi } from "vitest"

// ─── Mock WakeWordEngine ──────────────────────────────────────────────────────

type EventHandler = (payload: unknown) => void

let mockEngineInstance: {
  load: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
  handlers: Record<string, EventHandler>
  emit: (event: string, payload?: unknown) => void
}

vi.mock("../engines/wake-word/wake-word-engine.js", () => ({
  // eslint-disable-next-line prefer-arrow-callback
  WakeWordEngine: vi.fn().mockImplementation(function MockWakeWordEngine() {
    mockEngineInstance = {
      load: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      on: vi.fn().mockImplementation((event: string, handler: EventHandler) => {
        mockEngineInstance.handlers[event] = handler
        return () => {}
      }),
      off: vi.fn(),
      handlers: {} as Record<string, EventHandler>,
      emit(event: string, payload?: unknown) {
        const h = this.handlers[event]
        if (h) h(payload)
      },
    }
    return mockEngineInstance
  }),
}))

import { WakeWordVM } from "./wake-word.svelte.js"

// ─── mock AudioContext ────────────────────────────────────────────────────────

vi.stubGlobal("AudioContext", vi.fn().mockImplementation(() => ({
  state: "running",
  createOscillator: vi.fn(() => ({
    type: "sine",
    frequency: { value: 0 },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  })),
  createGain: vi.fn(() => ({
    gain: {
      value: 1,
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
  })),
  destination: {},
  currentTime: 0,
  resume: vi.fn(),
})))

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("WakeWordVM", () => {
  let vm: WakeWordVM

  beforeEach(() => {
    vi.clearAllMocks()
    vm = new WakeWordVM({
      keywords: ["hey_jarvis"],
      baseAssetUrl: "/test/models",
    })
  })

  test("default mode = off", () => {
    expect(vm.mode).toBe("off")
  })

  test("default flashCount = 0", () => {
    expect(vm.flashCount).toBe(0)
  })

  test("toggle() off -> listening", () => {
    vm.toggle()
    expect(vm.mode).toBe("listening")
  })

  test("toggle() listening -> off", () => {
    vm.toggle() // off -> listening
    vm.toggle() // listening -> off
    expect(vm.mode).toBe("off")
  })

  test("detect: flashCount++ on each detect event", () => {
    vm.toggle() // listening
    mockEngineInstance.emit("detect", { keyword: "hey_jarvis", score: 0.9, sinceVadStart: 5 })
    expect(vm.flashCount).toBe(1)
    mockEngineInstance.emit("detect", { keyword: "hey_jarvis", score: 0.9, sinceVadStart: 5 })
    expect(vm.flashCount).toBe(2)
  })

  test("detect #1 -> mode=recording", () => {
    vm.toggle() // listening
    mockEngineInstance.emit("detect", { keyword: "hey_jarvis", score: 0.9, sinceVadStart: 5 })
    expect(vm.mode).toBe("recording")
  })

  test("detect #2 -> mode=listening (back to listening)", () => {
    vm.toggle() // listening

    // detect #1
    mockEngineInstance.emit("detect", { keyword: "hey_jarvis", score: 0.9, sinceVadStart: 5 })
    expect(vm.mode).toBe("recording")

    // detect #2
    mockEngineInstance.emit("detect", { keyword: "hey_jarvis", score: 0.9, sinceVadStart: 5 })
    expect(vm.mode).toBe("listening")
  })

  test("level event updates vm.level", () => {
    vm.toggle()
    mockEngineInstance.emit("level", 0.42)
    expect(vm.level).toBeCloseTo(0.42, 6)
  })

  test("error event -> lastError set + mode=off", () => {
    vm.toggle()
    mockEngineInstance.emit("error", new Error("mic denied"))
    expect(vm.lastError).toBe("mic denied")
    expect(vm.mode).toBe("off")
  })
})
