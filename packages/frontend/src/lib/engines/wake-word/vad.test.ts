/**
 * Tests for vad.ts — createVadState + runVadStep.
 * משתמש ב-mock session (ללא ort).
 */

import { describe, expect, test, vi } from "vitest"
import { createVadState, runVadStep } from "./vad.js"

// ─── Mock ort ────────────────────────────────────────────────────────────────

/** Mock ort minimal interface */
const mockOrt = {
  Tensor: class MockTensor {
    type: string
    data: Float32Array | BigInt64Array
    dims: number[]
    constructor(
      type: string,
      data: Float32Array | BigInt64Array,
      dims: number[],
    ) {
      this.type = type
      this.data = data
      this.dims = dims
    }
  },
}

describe("createVadState", () => {
  test("מחזיר state עם h ו-c", () => {
    const state = createVadState(mockOrt as never)
    expect(state).toHaveProperty("h")
    expect(state).toHaveProperty("c")
  })

  test("h ו-c הם Float32Array של 128 אפסים", () => {
    const state = createVadState(mockOrt as never)
    const hData = (state.h as { data: Float32Array }).data
    const cData = (state.c as { data: Float32Array }).data
    expect(hData.length).toBe(128)
    expect(cData.length).toBe(128)
    expect(Array.from(hData).every((v) => v === 0)).toBe(true)
    expect(Array.from(cData).every((v) => v === 0)).toBe(true)
  })
})

describe("runVadStep", () => {
  test("מחזיר את output.data[0] מ-session", async () => {
    const expectedProb = 0.75

    const mockSession = {
      run: vi.fn().mockResolvedValue({
        output: { data: new Float32Array([expectedProb]) },
        hn: { type: "float32", data: new Float32Array(128), dims: [2, 1, 64] },
        cn: { type: "float32", data: new Float32Array(128), dims: [2, 1, 64] },
      }),
    }

    const state = createVadState(mockOrt as never)
    const frame = new Float32Array(1280).fill(0)

    const prob = await runVadStep(mockSession as never, frame, state, mockOrt as never)
    expect(prob).toBeCloseTo(expectedProb, 6)
  })

  test("מעדכן h ו-c ב-state (mutates)", async () => {
    const newHData = new Float32Array(128).fill(0.1)
    const newCData = new Float32Array(128).fill(0.2)

    const mockSession = {
      run: vi.fn().mockResolvedValue({
        output: { data: new Float32Array([0.3]) },
        hn: { type: "float32", data: newHData, dims: [2, 1, 64] },
        cn: { type: "float32", data: newCData, dims: [2, 1, 64] },
      }),
    }

    const state = createVadState(mockOrt as never)
    const frame = new Float32Array(1280).fill(0)

    await runVadStep(mockSession as never, frame, state, mockOrt as never)

    // state.h / state.c צריכים להיות מוחלפים ב-hn/cn
    expect(state.h).toEqual(
      expect.objectContaining({ data: newHData }),
    )
    expect(state.c).toEqual(
      expect.objectContaining({ data: newCData }),
    )
  })
})
