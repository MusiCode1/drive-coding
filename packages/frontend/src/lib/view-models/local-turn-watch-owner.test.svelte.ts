/**
 * LocalTurnWatchOwner — unit tests for stall watch lifecycle (slice state-local-turn-watch-owner).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { STALL_HARD_CAP_MS, STALL_NOTICE_MS } from "$lib/engines/turn-watchdog"
import { connWarn } from "$lib/util/conn-log"
import { LocalTurnWatchOwner } from "./local-turn-watch-owner.svelte"

vi.mock("$lib/util/conn-log", () => ({
  connWarn: vi.fn(),
}))

describe("LocalTurnWatchOwner", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.mocked(connWarn).mockClear()
  })

  it("start is idempotent — one interval only", () => {
    const owner = new LocalTurnWatchOwner({ onGiveUp: vi.fn(), enabled: true })
    owner.start()
    owner.start()
    expect(vi.getTimerCount()).toBe(1)
    owner.stop()
  })

  it("start no-op when disabled", () => {
    const owner = new LocalTurnWatchOwner({ onGiveUp: vi.fn(), enabled: false })
    owner.start()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("turnStarted clears prior hint and begins measurement", () => {
    const owner = new LocalTurnWatchOwner({ onGiveUp: vi.fn(), enabled: true })
    owner.start()
    owner.stalled = true
    owner.turnStarted(0)
    expect(owner.stalled).toBe(false)
    vi.advanceTimersByTime(STALL_NOTICE_MS - 1)
    expect(owner.stalled).toBe(false)
    vi.advanceTimersByTime(5_000 + 1)
    expect(owner.stalled).toBe(true)
    owner.stop()
  })

  it("noteActivity clears hint and resets silence clock", () => {
    const owner = new LocalTurnWatchOwner({ onGiveUp: vi.fn(), enabled: true })
    owner.start()
    owner.turnStarted(0)
    vi.advanceTimersByTime(STALL_NOTICE_MS + 5_000)
    expect(owner.stalled).toBe(true)
    owner.noteActivity(STALL_NOTICE_MS + 5_000)
    expect(owner.stalled).toBe(false)
    vi.advanceTimersByTime(5_000)
    expect(owner.stalled).toBe(false)
    owner.stop()
  })

  it("STALL_NOTICE_MS threshold raises hint once per stall period", () => {
    const owner = new LocalTurnWatchOwner({ onGiveUp: vi.fn(), enabled: true })
    owner.start()
    owner.turnStarted(0)
    vi.advanceTimersByTime(STALL_NOTICE_MS + 5_000)
    expect(owner.stalled).toBe(true)
    expect(connWarn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(5_000)
    expect(connWarn).toHaveBeenCalledTimes(1)
    owner.stop()
  })

  it("STALL_HARD_CAP_MS triggers give-up; callback repeats until turnEnded", () => {
    const onGiveUp = vi.fn()
    const owner = new LocalTurnWatchOwner({ onGiveUp, enabled: true })
    owner.start()
    owner.turnStarted(0)
    vi.advanceTimersByTime(STALL_HARD_CAP_MS - 5_000)
    expect(onGiveUp).not.toHaveBeenCalled()
    vi.advanceTimersByTime(5_000)
    expect(onGiveUp).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(5_000)
    expect(onGiveUp).toHaveBeenCalledTimes(2)
    owner.turnEnded()
    vi.advanceTimersByTime(5_000)
    expect(onGiveUp).toHaveBeenCalledTimes(2)
    owner.stop()
  })

  it("after give-up stalled is false when callback mirrors facade (turnEnded)", () => {
    let owner!: LocalTurnWatchOwner
    owner = new LocalTurnWatchOwner({
      onGiveUp: () => owner.turnEnded(),
      enabled: true,
    })
    owner.start()
    owner.turnStarted(0)
    vi.advanceTimersByTime(STALL_NOTICE_MS)
    vi.advanceTimersByTime(5_000)
    expect(owner.stalled).toBe(true)
    vi.advanceTimersByTime(STALL_HARD_CAP_MS - STALL_NOTICE_MS)
    vi.advanceTimersByTime(5_000)
    expect(owner.stalled).toBe(false)
    owner.stop()
  })

  it("turnEnded resets activity and hint without stopping interval", () => {
    const owner = new LocalTurnWatchOwner({ onGiveUp: vi.fn(), enabled: true })
    owner.start()
    owner.turnStarted(0)
    vi.advanceTimersByTime(STALL_NOTICE_MS + 5_000)
    expect(owner.stalled).toBe(true)
    owner.turnEnded()
    expect(owner.stalled).toBe(false)
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(10_000)
    expect(owner.stalled).toBe(false)
    owner.stop()
  })

  it("stop clears interval and hint", () => {
    const owner = new LocalTurnWatchOwner({ onGiveUp: vi.fn(), enabled: true })
    owner.start()
    owner.turnStarted(0)
    owner.stalled = true
    owner.stop()
    expect(vi.getTimerCount()).toBe(0)
    expect(owner.stalled).toBe(false)
    vi.advanceTimersByTime(60_000)
    expect(owner.stalled).toBe(false)
  })

  it("imported thresholds are 90_000 / 600_000", () => {
    expect(STALL_NOTICE_MS).toBe(90_000)
    expect(STALL_HARD_CAP_MS).toBe(600_000)
  })
})
