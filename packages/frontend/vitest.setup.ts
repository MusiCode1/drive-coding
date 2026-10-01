/**
 * vitest.setup.ts — minimal browser audio stubs for node environment tests.
 */
import { vi } from "vitest"

class MockAudio {
  currentTime = 0
  paused = true
  src = ""
  play = vi.fn(async () => {
    this.paused = false
  })
  pause = vi.fn(() => {
    this.paused = true
  })
  addEventListener = vi.fn()
  removeEventListener = vi.fn()
}

class MockMediaSource {
  readyState: ReadyState = "closed"
  addSourceBuffer = vi.fn(() => ({
    mode: "segments" as AppendMode,
    buffered: { length: 0, start: () => 0, end: () => 0 },
    appendBuffer: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  endOfStream = vi.fn()
  addEventListener(type: string, fn: EventListener) {
    if (type === "sourceopen") {
      this.readyState = "open"
      queueMicrotask(() => fn(new Event("sourceopen")))
    }
  }
  removeEventListener = vi.fn()
}

vi.stubGlobal("Audio", MockAudio)
vi.stubGlobal("MediaSource", MockMediaSource)

vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test")
vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
