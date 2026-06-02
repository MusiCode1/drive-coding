/**
 * WakeWordEngine — מנוע wake-word מלא: טעינת מודלים + מיקרופון + pipeline.
 *
 * מקביל ל-WakeWordDetector ב-POC (wake-word-lib.js:344).
 * Renames: WakeWordDetector→WakeWordEngine, לפי קונבנציות FE.
 *
 * Events: ready, frame, level, vadStart, vadEnd, detect, score, error.
 * אין $state כאן — זה engine, לא VM.
 */

import * as ort from "onnxruntime-web"
import type { WakeWordConfig, WakeWordEventMap } from "./types.js"
import { MODEL_FILE_MAP, DETECT_THRESHOLD, VAD_THRESHOLD } from "./types.js"
import { computeRms, FRAME_SIZE, SAMPLE_RATE } from "./audio-math.js"
import { createVadState, runVadStep } from "./vad.js"
import { createScorePipeline } from "./pipeline.js"

// single-thread mode — עוקף COOP/COEP שאינן מוגדרות (לקח מה-POC)
ort.env.wasm.numThreads = 1

// ─── Tiny event emitter ───────────────────────────────────────────────────────

type Handler<T> = (payload: T) => void

function createEmitter<Events extends Record<string, unknown>>() {
  const listeners = new Map<string, Set<Handler<unknown>>>()
  return {
    on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
      const key = event as string
      if (!listeners.has(key)) listeners.set(key, new Set())
      listeners.get(key)!.add(handler as Handler<unknown>)
      return () => listeners.get(key)?.delete(handler as Handler<unknown>)
    },
    off<K extends keyof Events>(event: K, handler: Handler<Events[K]>): void {
      listeners.get(event as string)?.delete(handler as Handler<unknown>)
    },
    emit<K extends keyof Events>(event: K, payload: Events[K]): void {
      const set = listeners.get(event as string)
      if (set) for (const h of Array.from(set)) h(payload)
    },
  }
}

// ─── AudioWorklet processor code (inline string) ─────────────────────────────

const AUDIO_PROCESSOR_CODE = `
  class AudioProcessor extends AudioWorkletProcessor {
    bufferSize = ${FRAME_SIZE};
    _buffer = new Float32Array(this.bufferSize);
    _pos = 0;
    process(inputs) {
      const input = inputs[0][0];
      if (input) {
        for (let i = 0; i < input.length; i++) {
          this._buffer[this._pos++] = input[i];
          if (this._pos === this.bufferSize) {
            this.port.postMessage(this._buffer);
            this._pos = 0;
          }
        }
      }
      return true;
    }
  }
  registerProcessor('audio-processor', AudioProcessor);
`

// ─── WakeWordEngine ───────────────────────────────────────────────────────────

export class WakeWordEngine {
  private readonly config: Required<WakeWordConfig> & {
    detectThreshold: number
    vadThreshold: number
  }
  private readonly emitter = createEmitter<WakeWordEventMap>()
  private models: {
    melspec: ort.InferenceSession
    embedding: ort.InferenceSession
    vad: ort.InferenceSession
    classifiers: Record<string, ort.InferenceSession>
  } | null = null
  private pipeline: ReturnType<typeof createScorePipeline> | null = null
  private vadState: ReturnType<typeof createVadState> | null = null
  private mic: { setGain(v: number): void; stop(): Promise<void> } | null = null
  private loaded = false

  // runtime state
  private frameIdx = 0
  private isSpeech = false
  private hangover = 0
  private vadStartFrame: number | null = null
  private cooling = false
  private queue: Promise<void> = Promise.resolve()

  constructor(config: WakeWordConfig) {
    this.config = {
      thresholds: {},
      cooldownMs: 2000,
      vadHangoverFrames: 12,
      gain: 1.0,
      ...config,
      detectThreshold: config.thresholds?.detect ?? DETECT_THRESHOLD,
      vadThreshold: config.thresholds?.vad ?? VAD_THRESHOLD,
    }
  }

  on<K extends keyof WakeWordEventMap>(
    event: K,
    handler: Handler<WakeWordEventMap[K]>,
  ): () => void {
    return this.emitter.on(event, handler)
  }

  off<K extends keyof WakeWordEventMap>(
    event: K,
    handler: Handler<WakeWordEventMap[K]>,
  ): void {
    this.emitter.off(event, handler)
  }

  get frameIndex(): number {
    return this.frameIdx
  }

  async load(): Promise<void> {
    if (this.loaded) return
    const base = this.config.baseAssetUrl.replace(/\/+$/, "")
    const opts = { executionProviders: ["wasm"] as const }
    const url = (f: string) => `${base}/${f}`

    const [melspec, embedding, vad] = await Promise.all([
      ort.InferenceSession.create(url("melspectrogram.onnx"), opts),
      ort.InferenceSession.create(url("embedding_model.onnx"), opts),
      ort.InferenceSession.create(url("silero_vad.onnx"), opts),
    ])

    const classifiers: Record<string, ort.InferenceSession> = {}
    for (const kw of this.config.keywords) {
      const file = MODEL_FILE_MAP[kw]
      if (!file) throw new Error(`No model file for keyword "${kw}"`)
      classifiers[kw] = await ort.InferenceSession.create(url(file), opts)
    }

    this.models = { melspec, embedding, vad, classifiers }
    this.pipeline = createScorePipeline({
      melModel: melspec,
      embModel: embedding,
      classifiers,
      ortRef: ort,
    })
    this.vadState = createVadState(ort)
    this.loaded = true
    this.emitter.emit("ready", undefined as never)
  }

  async start(): Promise<void> {
    if (!this.loaded) throw new Error("call load() before start()")
    if (this.mic) return
    this.resetRuntime()
    this.mic = await this.createMicStream()
  }

  async stop(): Promise<void> {
    if (this.mic) {
      await this.mic.stop()
      this.mic = null
    }
  }

  setGain(v: number): void {
    this.mic?.setGain(v)
  }

  private resetRuntime(): void {
    this.frameIdx = 0
    this.isSpeech = false
    this.hangover = 0
    this.vadStartFrame = null
    this.cooling = false
    this.pipeline?.reset()
    if (this.loaded) this.vadState = createVadState(ort)
  }

  private async createMicStream(): Promise<{
    setGain(v: number): void
    stop(): Promise<void>
  }> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
    })
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
    const source = ctx.createMediaStreamSource(stream)
    const gainNode = ctx.createGain()
    gainNode.gain.value = this.config.gain

    const blob = new Blob([AUDIO_PROCESSOR_CODE], { type: "application/javascript" })
    const blobUrl = URL.createObjectURL(blob)
    await ctx.audioWorklet.addModule(blobUrl)
    URL.revokeObjectURL(blobUrl)

    const node = new AudioWorkletNode(ctx, "audio-processor")
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (e.data) {
        const frame = e.data
        // סידור אסינכרוני של frames — לא ינתח frames במקביל
        this.queue = this.queue
          .then(() => this.onFrame(frame))
          .catch((err: unknown) =>
            this.emitter.emit("error", err instanceof Error ? err : new Error(String(err))),
          )
      }
    }

    source.connect(gainNode)
    gainNode.connect(node)
    node.connect(ctx.destination)

    return {
      setGain(v: number) {
        gainNode.gain.value = v
      },
      async stop() {
        node.port.onmessage = null
        node.disconnect()
        gainNode.disconnect()
        if (ctx.state !== "closed") await ctx.close()
        stream.getTracks().forEach((t) => t.stop())
      },
    }
  }

  private async onFrame(frame: Float32Array): Promise<void> {
    if (!this.models || !this.pipeline || !this.vadState) return
    this.frameIdx++

    // (0) raw frame — לmrecord/capture
    this.emitter.emit("frame", frame)

    // (1) loudness — כל frame
    this.emitter.emit("level", computeRms(frame))

    // (2) VAD
    const prob = await runVadStep(this.models.vad, frame, this.vadState, ort)
    const speaking = prob > this.config.vadThreshold
    if (speaking) {
      if (!this.isSpeech) {
        this.vadStartFrame = this.frameIdx
        this.emitter.emit("vadStart", undefined as never)
      }
      this.isSpeech = true
      this.hangover = this.config.vadHangoverFrames
    } else if (this.isSpeech) {
      this.hangover--
      if (this.hangover <= 0) {
        this.isSpeech = false
        const frames =
          this.vadStartFrame != null ? this.frameIdx - this.vadStartFrame : null
        this.emitter.emit("vadEnd", { frames })
      }
    }

    // (3) scores → detect (gated by VAD + cooldown)
    const scores = await this.pipeline.push(frame)
    if (scores) {
      this.emitter.emit("score", { scores })
      for (const name in scores) {
        const score = scores[name] ?? 0
        if (score > this.config.detectThreshold && this.isSpeech && !this.cooling) {
          this.cooling = true
          const since =
            this.vadStartFrame != null ? this.frameIdx - this.vadStartFrame : null
          this.emitter.emit("detect", { keyword: name, score, sinceVadStart: since })
          setTimeout(() => {
            this.cooling = false
          }, this.config.cooldownMs)
        }
      }
    }
  }
}
