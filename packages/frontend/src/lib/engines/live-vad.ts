/**
 * live-vad.ts — Silero-only VAD + speech gate for Live PCM filtering.
 *
 * Slice: live-silence-cost, Commit 1.
 * Uses createSpeechGate (core) + runVadStep (wake-word) — not WakeWordEngine.
 */

import { createSpeechGate } from "@drive-coding/core/voice/live-speech-gate"
import * as ort from "onnxruntime-web"
import { frameRms, liveNoteMic, liveSetFailOpen, liveSetVadLoaded } from "../util/live-log"
import { VAD_THRESHOLD } from "./wake-word/types.js"
import { createVadState, runVadStep } from "./wake-word/vad.js"

// single-thread mode — mirrors wake-word-engine.ts (COOP/COEP not set)
ort.env.wasm.numThreads = 1
ort.env.wasm.wasmPaths = "https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.22.0/"

const DEFAULT_PREFIX_FRAMES = 6
/**
 * gemini-3.1-flash-live-preview ends a turn after ~2s of *silent PCM
 * in the stream* (js-genai#1467). Stopping the stream after the core
 * default 640ms hangover never closes the turn — no transcript, no reply.
 * 28 × 80ms = 2.24s of real silence after speech, then we stop sending.
 */
const SERVER_VAD_HANGOVER_FRAMES = 28
const SILERO_MODEL = "silero_vad.onnx"

export class LiveVad {
  readonly #baseAssetUrl: string
  readonly #threshold: number
  readonly #prefixFrames: number
  readonly #gate: ReturnType<typeof createSpeechGate>

  #session: ort.InferenceSession | null = null
  #vadState = createVadState(ort)
  #prefixRing: Float32Array[] = []
  #loadPromise: Promise<void> | null = null
  #failOpen = false
  #passthrough: boolean
  /** Send every frame until the first hangover ends (opens the Gemini stream). */
  #prime = true
  #sentInPrime = false
  #queue: Promise<void> = Promise.resolve()

  constructor(opts?: {
    baseAssetUrl?: string
    threshold?: number
    prefixFrames?: number
    hangoverFrames?: number
    /** Send every frame (pre-slice path). VAD still runs for logs. */
    passthrough?: boolean
  }) {
    this.#baseAssetUrl = opts?.baseAssetUrl ?? "/wake-word/models"
    this.#threshold = opts?.threshold ?? VAD_THRESHOLD
    this.#prefixFrames = opts?.prefixFrames ?? DEFAULT_PREFIX_FRAMES
    this.#passthrough = opts?.passthrough ?? false
    this.#gate = createSpeechGate({
      hangoverFrames: opts?.hangoverFrames ?? SERVER_VAD_HANGOVER_FRAMES,
    })
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
      this.#session = await ort.InferenceSession.create(url, {
        executionProviders: ["wasm"],
      })
      liveSetVadLoaded(true)
    } catch {
      this.#failOpen = true
      liveSetVadLoaded(false)
    }
  }

  ingest(frame: Float32Array): Promise<readonly Float32Array[]> {
    const owned = new Float32Array(frame)
    if (this.#failOpen) {
      liveNoteMic({
        prob: null,
        speaking: true,
        sent: 1,
        rms: frameRms(owned),
        failOpen: true,
      })
      return Promise.resolve([owned])
    }
    const result = this.#queue.then(() => this.#ingestStep(owned))
    this.#queue = result.then(
      () => {},
      () => {},
    )
    return result.catch(() => {
      this.#failOpen = true
      liveSetFailOpen("ingest")
      liveNoteMic({
        prob: null,
        speaking: true,
        sent: 1,
        rms: frameRms(owned),
        failOpen: true,
      })
      return [owned]
    })
  }

  async #ingestStep(frame: Float32Array): Promise<readonly Float32Array[]> {
    const rms = frameRms(frame)
    if (this.#failOpen) {
      liveNoteMic({ prob: null, speaking: true, sent: 1, rms, failOpen: true })
      return [frame]
    }
    if (!this.#session) {
      liveNoteMic({ prob: null, speaking: true, sent: 1, rms, failOpen: false })
      return [frame]
    }

    this.#prefixRing.push(frame)
    if (this.#prefixRing.length > this.#prefixFrames) {
      this.#prefixRing.shift()
    }

    let prob: number
    try {
      prob = await runVadStep(this.#session, frame, this.#vadState, ort)
    } catch {
      this.#failOpen = true
      liveSetFailOpen("runVadStep")
      liveNoteMic({ prob: null, speaking: true, sent: 1, rms, failOpen: true })
      return [frame]
    }
    const speaking = prob >= this.#threshold
    const decision = this.#gate.step(speaking)
    const gated = !decision.sendCurrent ? [] : decision.flushPrefix ? [...this.#prefixRing] : [frame]
    let out = this.#passthrough ? [frame] : gated
    if (!this.#passthrough && this.#prime) {
      if (decision.sendCurrent) this.#sentInPrime = true
      if (this.#sentInPrime && !decision.sendCurrent) {
        this.#prime = false
        out = []
      } else {
        out = [frame]
      }
    }
    liveNoteMic({
      prob,
      speaking,
      sent: out.length,
      rms,
      failOpen: false,
    })
    return out
  }

  /** New Live session — stream silence from connect until the first hangover. */
  armPrime(): void {
    this.#prime = true
    this.#sentInPrime = false
  }

  reset(): void {
    this.#gate.reset()
    this.#prefixRing = []
    this.#vadState = createVadState(ort)
  }
}
