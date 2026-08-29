/**
 * live-vad.ts — Silero-only VAD + speech gate for Live PCM filtering.
 *
 * Slice: live-silence-cost, Commit 1.
 * Uses createSpeechGate (core) + runVadStep (wake-word) — not WakeWordEngine.
 */

import { createSpeechGate } from "@drive-coding/core/voice/live-speech-gate"
import * as ort from "onnxruntime-web"
import { createVadState, runVadStep } from "./wake-word/vad.js"
import { VAD_THRESHOLD } from "./wake-word/types.js"

// single-thread mode — mirrors wake-word-engine.ts (COOP/COEP not set)
ort.env.wasm.numThreads = 1
ort.env.wasm.wasmPaths = "https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.22.0/"

const DEFAULT_PREFIX_FRAMES = 6
const SILERO_MODEL = "silero_vad.onnx"

export class LiveVad {
  readonly #baseAssetUrl: string
  readonly #threshold: number
  readonly #prefixFrames: number
  readonly #gate = createSpeechGate()

  #session: ort.InferenceSession | null = null
  #vadState = createVadState(ort)
  #prefixRing: Float32Array[] = []
  #loadPromise: Promise<void> | null = null
  #failOpen = false
  #queue: Promise<void> = Promise.resolve()

  constructor(opts?: { baseAssetUrl?: string; threshold?: number; prefixFrames?: number }) {
    this.#baseAssetUrl = opts?.baseAssetUrl ?? "/wake-word/models"
    this.#threshold = opts?.threshold ?? VAD_THRESHOLD
    this.#prefixFrames = opts?.prefixFrames ?? DEFAULT_PREFIX_FRAMES
  }

  get loadFailed(): boolean {
    return this.#failOpen
  }

  load(): Promise<void> {
    if (this.#loadPromise) return this.#loadPromise
    this.#loadPromise = this.#doLoad()
    return this.#loadPromise
  }

  async #doLoad(): Promise<void> {
    try {
      const url = `${this.#baseAssetUrl}/${SILERO_MODEL}`
      this.#session = await ort.InferenceSession.create(url)
    } catch {
      this.#failOpen = true
    }
  }

  ingest(frame: Float32Array): Promise<readonly Float32Array[]> {
    if (this.#failOpen) {
      return Promise.resolve([frame])
    }
    const result = this.#queue.then(() => this.#ingestStep(frame))
    this.#queue = result.then(
      () => {},
      () => {},
    )
    return result
  }

  async #ingestStep(frame: Float32Array): Promise<readonly Float32Array[]> {
    if (this.#failOpen) {
      return [frame]
    }
    if (!this.#session) {
      return [frame]
    }

    this.#prefixRing.push(frame)
    if (this.#prefixRing.length > this.#prefixFrames) {
      this.#prefixRing.shift()
    }

    const prob = await runVadStep(this.#session, frame, this.#vadState, ort)
    const speaking = prob >= this.#threshold
    const decision = this.#gate.step(speaking)

    if (!decision.sendCurrent) {
      return []
    }

    if (decision.flushPrefix) {
      return [...this.#prefixRing]
    }

    return [frame]
  }

  reset(): void {
    this.#gate.reset()
    this.#prefixRing = []
    this.#vadState = createVadState(ort)
  }
}
