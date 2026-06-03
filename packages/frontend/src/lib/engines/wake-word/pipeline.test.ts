/**
 * Tests for pipeline.ts — inferWindowSize + createScorePipeline.
 * משתמש ב-mock InferenceSession (ללא ort/DOM).
 */

import { describe, expect, test, vi } from "vitest"
import { inferWindowSize, createScorePipeline } from "./pipeline.js"

// ─── Mock types עבור ort ────────────────────────────────────────────────────

/** Tensor מינימלי לצורך mock */
interface MockTensor {
  data: Float32Array
  dims: number[]
}

/** Mock session מינימלי */
interface MockSession {
  inputNames: string[]
  outputNames: string[]
  inputMetadata?: Record<string, { shape: number[] }>
  run: (feeds: Record<string, unknown>) => Promise<Record<string, MockTensor>>
}

/** Mock ortRef לשימוש ב-pipeline (Tensor פשוט שמחזיר object) */
const mockOrt = {
  Tensor: class MockTensor {
    type: string
    data: unknown
    dims: number[]
    constructor(type: string, data: unknown, dims: number[]) {
      this.type = type
      this.data = data
      this.dims = dims
    }
  },
}

// ─── inferWindowSize ─────────────────────────────────────────────────────────

describe("inferWindowSize", () => {
  test("מחזיר shape[1] כשהמטדטה קיימת", () => {
    const session: MockSession = {
      inputNames: ["embedding"],
      outputNames: ["output"],
      inputMetadata: { embedding: { shape: [1, 22, 96] } },
      run: vi.fn(),
    }
    expect(inferWindowSize(session as never)).toBe(22)
  })

  test("fallback=16 כשאין מטדטה", () => {
    const session: MockSession = {
      inputNames: ["embedding"],
      outputNames: ["output"],
      run: vi.fn(),
    }
    expect(inferWindowSize(session as never)).toBe(16)
  })

  test("fallback מותאם אישית", () => {
    const session: MockSession = {
      inputNames: ["embedding"],
      outputNames: ["output"],
      run: vi.fn(),
    }
    expect(inferWindowSize(session as never, 34)).toBe(34)
  })

  test("fallback כשה-shape לא finite", () => {
    const session: MockSession = {
      inputNames: ["embedding"],
      outputNames: ["output"],
      inputMetadata: { embedding: { shape: [1, NaN, 96] } },
      run: vi.fn(),
    }
    expect(inferWindowSize(session as never)).toBe(16)
  })
})

// ─── createScorePipeline ─────────────────────────────────────────────────────

/** יוצר mock session שמחזיר tensor בגודל קבוע */
function makeMockMelSession(): MockSession {
  return {
    inputNames: ["input"],
    outputNames: ["output"],
    run: vi.fn().mockImplementation(async () => {
      // 5 × 32 = 160 ערכים (5 mel rows × 32 bins)
      const data = new Float32Array(160).fill(0)
      return {
        output: { data, dims: [1, 5, 32] },
      }
    }),
  }
}

function makeMockEmbSession(): MockSession {
  return {
    inputNames: ["input"],
    outputNames: ["embedding"],
    run: vi.fn().mockImplementation(async () => {
      // 96-dim embedding
      return {
        embedding: { data: new Float32Array(96).fill(0.1), dims: [1, 96] },
      }
    }),
  }
}

function makeMockClassifierSession(windowSize: number): MockSession {
  return {
    inputNames: ["embedding"],
    outputNames: ["score"],
    inputMetadata: { embedding: { shape: [1, windowSize, 96] } },
    run: vi.fn().mockImplementation(async () => ({
      score: { data: new Float32Array([0.8]), dims: [1, 1] },
    })),
  }
}

describe("createScorePipeline", () => {
  test("מחזיר null עד שחלון 76 mel מתמלא", async () => {
    const melSession = makeMockMelSession()
    const embSession = makeMockEmbSession()
    const classifierSession = makeMockClassifierSession(16)

    const pipeline = createScorePipeline({
      melModel: melSession as never,
      embModel: embSession as never,
      classifiers: { hey_jarvis: classifierSession as never },
      ortRef: mockOrt as never,
    })

    // כל push מוסיף 5 rows. צריך 76 → 76/5 = 15.2 → push 15 = 75 rows (לא מספיק)
    const frame = new Float32Array(1280).fill(0)

    // 14 pushes = 70 rows → לא מספיק
    for (let i = 0; i < 14; i++) {
      const result = await pipeline.push(frame)
      expect(result).toBeNull()
    }
  })

  test("מחזיר scores אחרי מילוי חלון 76", async () => {
    const melSession = makeMockMelSession()
    const embSession = makeMockEmbSession()
    const classifierSession = makeMockClassifierSession(16)

    const pipeline = createScorePipeline({
      melModel: melSession as never,
      embModel: embSession as never,
      classifiers: { hey_jarvis: classifierSession as never },
      ortRef: mockOrt as never,
    })

    const frame = new Float32Array(1280).fill(0)

    // 16 pushes = 80 rows ≥ 76 → pipeline יחזיר scores
    let lastResult: Record<string, number> | null = null
    for (let i = 0; i < 16; i++) {
      lastResult = await pipeline.push(frame)
    }

    expect(lastResult).not.toBeNull()
    expect(lastResult).toHaveProperty("hey_jarvis")
    expect(typeof lastResult!["hey_jarvis"]).toBe("number")
  })

  test("windows מכיל את גודל החלון של כל classifier", () => {
    const pipeline = createScorePipeline({
      melModel: makeMockMelSession() as never,
      embModel: makeMockEmbSession() as never,
      classifiers: {
        hey_jarvis: makeMockClassifierSession(16) as never,
        alexa: makeMockClassifierSession(22) as never,
        hey_rhasspy: makeMockClassifierSession(34) as never,
      },
      ortRef: mockOrt as never,
    })

    expect(pipeline.windows["hey_jarvis"]).toBe(16)
    expect(pipeline.windows["alexa"]).toBe(22)
    expect(pipeline.windows["hey_rhasspy"]).toBe(34)
  })

  test("reset() מנקה את ה-buffers (מחזיר null לאחר מכן)", async () => {
    const melSession = makeMockMelSession()
    const embSession = makeMockEmbSession()
    const classifierSession = makeMockClassifierSession(16)

    const pipeline = createScorePipeline({
      melModel: melSession as never,
      embModel: embSession as never,
      classifiers: { hey_jarvis: classifierSession as never },
      ortRef: mockOrt as never,
    })

    const frame = new Float32Array(1280).fill(0)

    // ממלא עד לפני הפקה
    for (let i = 0; i < 16; i++) await pipeline.push(frame)

    pipeline.reset()

    // אחרי reset — null שוב עד שחלון מתמלא מחדש
    const afterReset = await pipeline.push(frame)
    expect(afterReset).toBeNull()
  })
})
