/**
 * live-log.test.ts — ring + snapshot + speech-edge logging.
 * @vitest-environment jsdom
 */

import { addSink, type LogEntry } from "@drive-coding/core/log"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  frameRms,
  liveEvents,
  liveInfo,
  liveNoteMic,
  liveResetCounters,
  liveSetState,
  liveSnapshot,
  resetLiveLogForTests,
} from "./live-log"

describe("live-log", () => {
  afterEach(() => {
    resetLiveLogForTests()
    vi.restoreAllMocks()
  })

  it("records state transitions in the ring", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    liveResetCounters()
    liveSetState("connecting")
    liveSetState("open")
    const events = liveEvents()
    expect(events.map((e) => e.event)).toEqual(["state", "state"])
    expect(events[1]?.detail).toContain("state=open")
    expect(info).toHaveBeenCalled()
  })

  it("logs speech-start immediately and coalesces later mic ticks", () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    liveResetCounters()
    liveNoteMic({ prob: 0.9, speaking: true, sent: 2, rms: 0.2, failOpen: false })
    liveNoteMic({ prob: 0.8, speaking: true, sent: 1, rms: 0.18, failOpen: false })
    const events = liveEvents()
    expect(events.filter((e) => e.event === "speech-start")).toHaveLength(1)
    expect(events.filter((e) => e.event === "mic")).toHaveLength(0)
    const snap = liveSnapshot()
    expect(snap.framesIn).toBe(2)
    expect(snap.framesSent).toBe(3)
    expect(snap.speaking).toBe(true)
  })

  it("frameRms is 0 for silence and >0 for a signal", () => {
    expect(frameRms(new Float32Array(8))).toBe(0)
    expect(frameRms(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeGreaterThan(0.4)
  })

  it("forwards to the core logger under fe.live", () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const entries: LogEntry[] = []
    const remove = addSink((e) => entries.push(e))
    liveInfo("token", { model: "m" })
    remove()
    expect(entries.some((e) => e.ns === "fe.live" && e.msg === "token")).toBe(true)
  })
})
