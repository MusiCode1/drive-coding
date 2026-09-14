/**
 * live-vad.test.ts — LiveVad with mocked runVadStep (no ONNX).
 *
 * Slice: live-silence-cost, Commit 1.
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi, beforeEach } from "vitest"

const runVadStepMock = vi.fn()

vi.mock("./wake-word/vad.js", () => ({
  createVadState: vi.fn(() => ({ h: {}, c: {} })),
  runVadStep: (...args: unknown[]) => runVadStepMock(...args),
}))

vi.mock("onnxruntime-web", () => ({
  env: { wasm: { numThreads: 1, wasmPaths: "" } },
  InferenceSession: {
    create: vi.fn(async () => ({ run: vi.fn() })),
  },
  Tensor: class {},
}))

import { LiveVad } from "./live-vad"

describe("LiveVad", () => {
  beforeEach(() => {
    runVadStepMock.mockReset()
    runVadStepMock.mockResolvedValue(0)
  })

  it("drops silent frames after speech hangover", async () => {
    runVadStepMock.mockResolvedValueOnce(0.9).mockResolvedValue(0.01)
    const vad = new LiveVad({ prefixFrames: 2, hangoverFrames: 8 })
    await vad.load()

    const frame = new Float32Array(1280).fill(0.1)
    const speech = await vad.ingest(frame)
    expect(speech.length).toBeGreaterThan(0)

    for (let i = 0; i < 10; i++) {
      const silent = await vad.ingest(new Float32Array(1280))
      if (silent.length === 0) {
        expect(i).toBeGreaterThan(0)
        return
      }
    }
    expect.fail("expected silent frames to be dropped")
  })

  it("fail-open sends the frame when runVadStep throws", async () => {
    runVadStepMock.mockRejectedValueOnce(new Error("ort"))
    const vad = new LiveVad()
    await vad.load()

    const frame = new Float32Array(1280).fill(0.3)
    const out = await vad.ingest(frame)
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual(frame)
    expect(vad.loadFailed).toBe(true)

    runVadStepMock.mockRejectedValue(new Error("ort"))
    const again = await vad.ingest(new Float32Array(1280).fill(0.4))
    expect(again).toHaveLength(1)
  })

  it("fail-open sends every frame when load fails", async () => {
    const { InferenceSession } = await import("onnxruntime-web")
    vi.mocked(InferenceSession.create).mockRejectedValueOnce(new Error("network"))

    const vad = new LiveVad()
    await vad.load()
    expect(vad.loadFailed).toBe(true)

    const frame = new Float32Array(1280)
    const out = await vad.ingest(frame)
    expect(out).toEqual([frame])
  })

  it("prime forwards leading silence until the first hangover ends", async () => {
    runVadStepMock.mockResolvedValue(0.01)
    const vad = new LiveVad({ prefixFrames: 2, hangoverFrames: 8 })
    await vad.load()

    const silent = new Float32Array(1280)
    const leading = await vad.ingest(silent)
    expect(leading).toHaveLength(1)
  })

  it("passthrough sends silent frames the gate would drop", async () => {
    runVadStepMock.mockResolvedValue(0.01)
    const vad = new LiveVad({ prefixFrames: 2, hangoverFrames: 8, passthrough: true })
    await vad.load()

    const silent = new Float32Array(1280)
    const out = await vad.ingest(silent)
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual(silent)
  })

  it("reset clears gate state (next speech flushes prefix again)", async () => {
    runVadStepMock.mockResolvedValue(0.9)
    const vad = new LiveVad({ prefixFrames: 3 })
    await vad.load()

    const frame = new Float32Array(1280).fill(0.2)
    await vad.ingest(frame)
    vad.reset()

    runVadStepMock.mockResolvedValue(0.9)
    const out = await vad.ingest(frame)
    expect(out.length).toBeGreaterThan(0)
  })
})
