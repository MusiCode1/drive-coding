/**
 * Tests for WakeWordCapture — buffer + trim logic (unit).
 * אין IO: אין getUserMedia, אין AudioContext.
 */

import { describe, expect, test } from "vitest"
import { WakeWordCapture } from "./capture.js"

describe("WakeWordCapture", () => {
  test("capturing=false לפני start()", () => {
    const cap = new WakeWordCapture()
    expect(cap.capturing).toBe(false)
  })

  test("capturing=true אחרי start()", () => {
    const cap = new WakeWordCapture()
    cap.start()
    expect(cap.capturing).toBe(true)
  })

  test("pushFrame לא מצרף כשלא capturing", () => {
    const cap = new WakeWordCapture()
    cap.pushFrame(new Float32Array(10).fill(1))
    cap.start()
    // אחרי start, push — ואז stop ללא trim
    cap.pushFrame(new Float32Array(10).fill(0.5))
    const result = cap.stop(0)
    // רק frame שהגיע אחרי start
    expect(result).not.toBeNull()
    expect(result!.frames).toBe(0) // פחות מ-FRAME_SIZE=1280 → 0 frames שלמים
  })

  test("stop(0) מחזיר את כל ה-frames ללא trim", () => {
    const cap = new WakeWordCapture()
    cap.start()
    for (let i = 0; i < 5; i++) cap.pushFrame(new Float32Array(1280).fill(0))
    const result = cap.stop(0)
    expect(result).not.toBeNull()
    expect(result!.frames).toBe(5)
  })

  test("stop(2) חותך 2 frames מהסוף", () => {
    const cap = new WakeWordCapture()
    cap.start()
    for (let i = 0; i < 10; i++) cap.pushFrame(new Float32Array(1280).fill(0))
    const result = cap.stop(2)
    expect(result).not.toBeNull()
    expect(result!.frames).toBe(8)
  })

  test("stop() על buffer ריק → null", () => {
    const cap = new WakeWordCapture()
    cap.start()
    const result = cap.stop(0)
    expect(result).toBeNull()
  })

  test("abort() מנקה buffer ומאפס capturing", () => {
    const cap = new WakeWordCapture()
    cap.start()
    cap.pushFrame(new Float32Array(1280).fill(0))
    cap.abort()
    expect(cap.capturing).toBe(false)
    // stop אחרי abort — null (buffer ריק)
    const result = cap.stop(0)
    expect(result).toBeNull()
  })

  test("capturing=false אחרי stop()", () => {
    const cap = new WakeWordCapture()
    cap.start()
    cap.pushFrame(new Float32Array(1280).fill(0))
    cap.stop()
    expect(cap.capturing).toBe(false)
  })

  test("stop() מחזיר wavBytes כ-Uint8Array", () => {
    const cap = new WakeWordCapture()
    cap.start()
    cap.pushFrame(new Float32Array(1280).fill(0.1))
    const result = cap.stop(0)
    expect(result).not.toBeNull()
    expect(result!.wavBytes).toBeInstanceOf(Uint8Array)
    // header 44 bytes + 1280 samples × 2 bytes
    expect(result!.wavBytes.byteLength).toBe(44 + 1280 * 2)
  })
})
