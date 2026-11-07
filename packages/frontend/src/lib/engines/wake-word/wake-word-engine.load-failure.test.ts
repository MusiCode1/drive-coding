/**
 * wake-word-engine.load-failure.test.ts — load() fail-open when ONNX fetch fails.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from "vitest"

vi.mock("onnxruntime-web", () => ({
  env: { wasm: { numThreads: 1, wasmPaths: "" } },
  InferenceSession: {
    create: vi.fn(async () => ({ run: vi.fn() })),
  },
  Tensor: class {},
}))

import { WakeWordEngine } from "./wake-word-engine.js"

describe("WakeWordEngine load failure", () => {
  it("fail-open does not throw when InferenceSession.create rejects", async () => {
    const { InferenceSession } = await import("onnxruntime-web")
    vi.mocked(InferenceSession.create).mockRejectedValueOnce(new Error("network"))

    const engine = new WakeWordEngine({
      keywords: ["hey_jarvis"],
      baseAssetUrl: "https://example.test/models",
    })

    const onError = vi.fn()
    engine.on("error", onError)

    await expect(engine.load()).resolves.toBeUndefined()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error)
    expect(engine.loadFailed).toBe(true)
  })
})
