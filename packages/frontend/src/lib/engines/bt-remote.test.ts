/**
 * bt-remote.test.ts — TDD למנוע מיזוג KEY+MEDIA, סיווג tap/hold, dedup.
 */
import { describe, expect, it } from "vitest"
import {
  BtRemoteEngine,
  BURST_GAP_MS,
  buttonForKeyCode,
  buttonForMediaAction,
  HOLD_THRESHOLD_MS,
  PREHOLD_TIMEOUT_MS,
  TICK_INTERVAL_MS,
} from "./bt-remote.js"

/** מריץ tick כל TICK_INTERVAL_MS — כמו ה-route. */
function runTicks(engine: BtRemoteEngine, fromMs: number, toMs: number): void {
  for (let t = fromMs + TICK_INTERVAL_MS; t <= toMs; t += TICK_INTERVAL_MS) {
    engine.tick(t)
  }
}

describe("bt-remote", () => {
  it("classifies a 5ms down/up as a tap", () => {
    const engine = new BtRemoteEngine()
    engine.ingestKey({ type: "down", code: "MediaTrackNext", at: 0 })
    const cmd = engine.ingestKey({ type: "up", code: "MediaTrackNext", at: 5 })
    expect(cmd).toEqual({
      button: "next",
      gesture: "tap",
      channel: "key",
      at: 0,
      emittedAt: 5,
      holdMs: 5,
      pulses: 1,
      closedBy: "up",
    })
  })

  it("groups a held burst into a single hold command", () => {
    const engine = new BtRemoteEngine()
    engine.ingestKey({ type: "down", code: "MediaPlayPause", at: 0 })
    runTicks(engine, 0, 399)
    engine.ingestKey({ type: "down", code: "MediaPlayPause", at: 400 })
    for (let t = 450; t <= 1450; t += 50) {
      engine.ingestKey({ type: "down", code: "MediaPlayPause", at: t })
    }
    const cmd = engine.ingestKey({ type: "up", code: "MediaPlayPause", at: 1500 })
    expect(cmd).toMatchObject({
      button: "center",
      gesture: "hold",
      channel: "key",
      at: 0,
      emittedAt: 1500,
      holdMs: 1500,
      pulses: 23,
      closedBy: "up",
    })
  })

  it("absorbs the pre-hold fragment into the hold (pulses=23)", () => {
    const engine = new BtRemoteEngine()
    engine.ingestKey({ type: "down", code: "MediaPlayPause", at: 0 })
    runTicks(engine, 0, 399)
    engine.ingestKey({ type: "down", code: "MediaPlayPause", at: 400 })
    for (let t = 450; t <= 1450; t += 50) {
      engine.ingestKey({ type: "down", code: "MediaPlayPause", at: t })
    }
    engine.ingestKey({ type: "up", code: "MediaPlayPause", at: 1500 })
    expect(engine.stats.preholdsAbsorbed).toBe(1)
    expect(engine.stats.preholdGapFlushes).toBe(0)
  })

  it("emits a hold when a long press produces no burst, under a live tick loop", () => {
    const engine = new BtRemoteEngine()
    engine.ingestKey({ type: "down", code: "MediaTrackNext", at: 0 })
    runTicks(engine, 0, 699)
    const pendingMid = engine.pending(350)
    expect(pendingMid.length).toBeGreaterThan(0)
    expect(pendingMid[0]?.wouldBeHold).toBe(false)
    const pendingLate = engine.pending(500)
    expect(pendingLate[0]?.wouldBeHold).toBe(true)
    const cmd = engine.ingestKey({ type: "up", code: "MediaTrackNext", at: 700 })
    expect(cmd).toMatchObject({
      gesture: "hold",
      at: 0,
      holdMs: 700,
      pulses: 1,
      closedBy: "up",
    })
    const tickCmds = runTicksCollect(engine, 0, 699)
    expect(tickCmds).toHaveLength(0)
  })

  it("emits a hold, never a tap, when the UP never arrives", () => {
    const engine = new BtRemoteEngine()
    engine.ingestKey({ type: "down", code: "MediaTrackPrevious", at: 0 })
    const cmds = runTicksCollect(engine, 0, 5100)
    expect(cmds).toHaveLength(1)
    expect(cmds[0]).toEqual({
      button: "prev",
      gesture: "hold",
      channel: "key",
      at: 0,
      pulses: 1,
      holdMs: PREHOLD_TIMEOUT_MS,
      emittedAt: PREHOLD_TIMEOUT_MS,
      closedBy: "timeout",
    })
    expect(engine.stats.preholdTimeouts).toBe(1)
    const more = runTicksCollect(engine, 5100, 10_000)
    expect(more).toHaveLength(0)
  })

  it("ignores an UP that arrives after the timeout emission", () => {
    const engine = new BtRemoteEngine()
    engine.ingestKey({ type: "down", code: "MediaTrackPrevious", at: 0 })
    runTicksCollect(engine, 0, 5100)
    const cmd = engine.ingestKey({ type: "up", code: "MediaTrackPrevious", at: 6000 })
    expect(cmd).toBeNull()
    expect(engine.stats.orphanUps).toBe(1)
  })

  it("emits the fragment as a hold when the next burst is too late to absorb it", () => {
    const engine = new BtRemoteEngine()
    engine.ingestKey({ type: "down", code: "MediaTrackNext", at: 0 })
    runTicks(engine, 0, 799)
    const cmd = engine.ingestKey({ type: "down", code: "MediaTrackNext", at: 800 })
    expect(cmd).toMatchObject({
      gesture: "hold",
      at: 0,
      holdMs: 800,
      pulses: 1,
      closedBy: "gap",
    })
    expect(engine.stats.preholdGapFlushes).toBe(1)
  })

  it("suppresses the same button arriving on the other channel", () => {
    const engine = new BtRemoteEngine()
    engine.ingestKey({ type: "down", code: "MediaTrackNext", at: 0 })
    const first = engine.ingestKey({ type: "up", code: "MediaTrackNext", at: 5 })
    expect(first).not.toBeNull()
    const second = engine.ingestMediaAction("nexttrack", 100)
    expect(second).toBeNull()
    expect(engine.stats.suppressedCrossChannel).toBe(1)
  })

  it("suppresses a cross-channel duplicate that follows a hold", () => {
    const engine = new BtRemoteEngine()
    engine.ingestKey({ type: "down", code: "MediaPlayPause", at: 0 })
    runTicks(engine, 0, 399)
    engine.ingestKey({ type: "down", code: "MediaPlayPause", at: 400 })
    for (let t = 450; t <= 1450; t += 50) {
      engine.ingestKey({ type: "down", code: "MediaPlayPause", at: t })
    }
    engine.ingestKey({ type: "up", code: "MediaPlayPause", at: 1500 })
    const dup = engine.ingestMediaAction("pause", 1550)
    expect(dup).toBeNull()
    expect(engine.stats.suppressedCrossChannel).toBe(1)
  })

  it("does not suppress repeated taps on the same channel", () => {
    const engine = new BtRemoteEngine()
    const first = engine.ingestMediaAction("nexttrack", 0)
    const second = engine.ingestMediaAction("nexttrack", 100)
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(engine.stats.emitted).toBe(2)
    expect(engine.stats.suppressedCrossChannel).toBe(0)
  })

  it("maps key codes and media actions to buttons", () => {
    expect(buttonForKeyCode("MediaTrackNext")).toBe("next")
    expect(buttonForKeyCode("MediaTrackPrevious")).toBe("prev")
    expect(buttonForKeyCode("MediaPlayPause")).toBe("center")
    expect(buttonForMediaAction("nexttrack")).toBe("next")
    expect(buttonForMediaAction("previoustrack")).toBe("prev")
    expect(buttonForMediaAction("pause")).toBe("center")

    const engine = new BtRemoteEngine()
    const cmd = engine.ingestMediaAction("pause", 0)
    expect(cmd).toMatchObject({
      button: "center",
      gesture: "tap",
      channel: "media",
      closedBy: "action",
    })

    const unknown = engine.ingestKey({ type: "down", code: "KeyA", at: 0 })
    expect(unknown).toBeNull()
    expect(engine.stats.emitted).toBe(1)
  })

  it("reports a waiting prehold as a growing hold", () => {
    const engine = new BtRemoteEngine()
    engine.ingestKey({ type: "down", code: "MediaTrackNext", at: 0 })
    runTicks(engine, 0, 300)
    const pending = engine.pending(300)
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({
      code: "MediaTrackNext",
      button: "next",
      pulses: 1,
      elapsedMs: 300,
      wouldBeHold: false,
    })
    const pendingHold = engine.pending(HOLD_THRESHOLD_MS)
    expect(pendingHold[0]?.wouldBeHold).toBe(true)
  })

  // ‏המסלול השני לפליטה-כפולה, ‏שכלב תפס (‏ממצא 1): ‏הפסקה >250ms ‏באמצע burst
  // ‏רב-פולסי סוגרת אותו ב-"gap" ‏ופולטת `hold` ‏**‏בלי לעבור דרך prehold** ⇒
  // ‏`preholdGapFlushes` ‏נשאר 0. ‏בלי מונה משלו, ‏הלחיצה הכפולה בלתי-נראית בייצוא.
  it("counts a multi-pulse burst that ends in silence rather than an UP", () => {
    const engine = new BtRemoteEngine()
    engine.ingestKey({ type: "down", code: "MediaPlayPause", at: 0 })
    engine.ingestKey({ type: "down", code: "MediaPlayPause", at: 50 })
    // ‏הפסקה ארוכה מ-BURST_GAP_MS ‏בזמן שהכפתור עדיין לחוץ
    const flushed = engine.tick(50 + BURST_GAP_MS + TICK_INTERVAL_MS)
    expect(flushed).toHaveLength(1)
    expect(flushed[0]?.gesture).toBe("hold")
    expect(flushed[0]?.closedBy).toBe("gap")

    // ‏הלחיצה ממשיכה ⇒ ‏burst שני (‏רב-פולסי) ⇒ ‏`hold` ‏שנייה על אותה לחיצה פיזית
    engine.ingestKey({ type: "down", code: "MediaPlayPause", at: 500 })
    engine.ingestKey({ type: "down", code: "MediaPlayPause", at: 550 })
    const second = engine.ingestKey({ type: "up", code: "MediaPlayPause", at: 700 })
    expect(second?.gesture).toBe("hold")

    // ‏שתי `hold` ‏על לחיצה אחת — ‏ו**‏המונה רואה את זה**.
    expect(engine.stats.preholdGapFlushes).toBe(0)
    expect(engine.stats.burstGapCloses).toBe(1)
  })

  it("exports timing constants", () => {
    expect(BURST_GAP_MS).toBe(250)
    expect(HOLD_THRESHOLD_MS).toBe(400)
    expect(TICK_INTERVAL_MS).toBe(50)
  })
})

function runTicksCollect(engine: BtRemoteEngine, fromMs: number, toMs: number) {
  const out = []
  for (let t = fromMs + TICK_INTERVAL_MS; t <= toMs; t += TICK_INTERVAL_MS) {
    out.push(...engine.tick(t))
  }
  return out
}
