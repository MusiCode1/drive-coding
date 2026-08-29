/**
 * live-speech-gate.test.ts — TDD for client-side speech gate (hangover + prefix flush).
 *
 * Slice: live-silence-cost, Commit 0.
 */

import { describe, expect, it } from "vitest"
import { createSpeechGate, LIVE_SPEECH_HANGOVER_FRAMES } from "./live-speech-gate"

describe("LIVE_SPEECH_HANGOVER_FRAMES", () => {
  it("defaults to 8 frames (~640ms @ 80ms)", () => {
    expect(LIVE_SPEECH_HANGOVER_FRAMES).toBe(8)
  })
})

describe("createSpeechGate", () => {
  it("idle → speech: send current and flush prefix", () => {
    const gate = createSpeechGate()
    expect(gate.step(true)).toEqual({ sendCurrent: true, flushPrefix: true })
  })

  it("sending → speech: send current, no prefix flush", () => {
    const gate = createSpeechGate()
    gate.step(true)
    expect(gate.step(true)).toEqual({ sendCurrent: true, flushPrefix: false })
  })

  it("sending → silence: hangover sends without flush", () => {
    const gate = createSpeechGate({ hangoverFrames: 2 })
    gate.step(true)
    expect(gate.step(false)).toEqual({ sendCurrent: true, flushPrefix: false })
    expect(gate.step(false)).toEqual({ sendCurrent: true, flushPrefix: false })
  })

  it("hangover exhausted → silence: drop frame", () => {
    const gate = createSpeechGate({ hangoverFrames: 1 })
    gate.step(true)
    gate.step(false) // hangover frame 1
    expect(gate.step(false)).toEqual({ sendCurrent: false, flushPrefix: false })
  })

  it("idle silence: drop frame", () => {
    const gate = createSpeechGate()
    expect(gate.step(false)).toEqual({ sendCurrent: false, flushPrefix: false })
  })

  it("reset() returns to idle (next speech flushes prefix again)", () => {
    const gate = createSpeechGate()
    gate.step(true)
    gate.step(true)
    gate.reset()
    expect(gate.step(true)).toEqual({ sendCurrent: true, flushPrefix: true })
  })

  it("uses default hangover length", () => {
    const gate = createSpeechGate()
    gate.step(true)
    for (let i = 0; i < LIVE_SPEECH_HANGOVER_FRAMES; i++) {
      expect(gate.step(false).sendCurrent).toBe(true)
    }
    expect(gate.step(false)).toEqual({ sendCurrent: false, flushPrefix: false })
  })
})
