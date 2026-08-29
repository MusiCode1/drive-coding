/**
 * MicFrames — standalone AudioWorklet mic capture for Live PCM streaming.
 *
 * Independent of WakeWordEngine (no ONNX). Outputs Float32Array frames
 * at 16kHz, 1280 samples (80ms) per frame.
 *
 * Slice: live-ears, Commit 0.
 */

import { liveInfo } from "../util/live-log"

export type MicFrame = Float32Array

const SAMPLE_RATE = 16_000
const FRAME_SIZE = 1280

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
  registerProcessor('mic-frames-processor', AudioProcessor);
`

type Handler<T> = (payload: T) => void

function createEmitter<Events extends Record<string, unknown>>() {
  const listeners = new Map<string, Set<Handler<unknown>>>()
  return {
    on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
      const key = event as string
      if (!listeners.has(key)) listeners.set(key, new Set())
      listeners.get(key)?.add(handler as Handler<unknown>)
      return () => listeners.get(key)?.delete(handler as Handler<unknown>)
    },
    emit<K extends keyof Events>(event: K, payload: Events[K]): void {
      const set = listeners.get(event as string)
      if (set) for (const h of Array.from(set)) h(payload)
    },
  }
}

function computeRms(chunk: Float32Array): number {
  let sum = 0
  for (let i = 0; i < chunk.length; i++) {
    const s = chunk[i] ?? 0
    sum += s * s
  }
  return Math.sqrt(sum / chunk.length)
}

type MicFramesEvents = {
  frame: MicFrame
  level: number
}

export class MicFrames {
  readonly sampleRate = SAMPLE_RATE

  readonly #emitter = createEmitter<MicFramesEvents>()
  #level = 0
  #stream: MediaStream | null = null
  #ctx: AudioContext | null = null
  #node: AudioWorkletNode | null = null

  get level(): number {
    return this.#level
  }

  on(event: "frame", handler: (f: MicFrame) => void): () => void
  on(event: "level", handler: (rms: number) => void): () => void
  on(event: "frame" | "level", handler: (payload: MicFrame | number) => void): () => void {
    if (event === "frame") {
      return this.#emitter.on("frame", handler as Handler<MicFrame>)
    }
    return this.#emitter.on("level", handler as Handler<number>)
  }

  async start(deviceId?: string | null): Promise<void> {
    if (this.#stream) return

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
    })
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
    const source = ctx.createMediaStreamSource(stream)

    const blob = new Blob([AUDIO_PROCESSOR_CODE], { type: "application/javascript" })
    const blobUrl = URL.createObjectURL(blob)
    await ctx.audioWorklet.addModule(blobUrl)
    URL.revokeObjectURL(blobUrl)

    const node = new AudioWorkletNode(ctx, "mic-frames-processor")
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (!e.data) return
      const frame = e.data
      this.#level = computeRms(frame)
      this.#emitter.emit("frame", frame)
      this.#emitter.emit("level", this.#level)
    }

    source.connect(node)
    // Keep the node in the graph so process() runs, but mute loopback —
    // playing the mic into destination trips echo-cancellation on phones.
    const mute = ctx.createGain()
    mute.gain.value = 0
    node.connect(mute)
    mute.connect(ctx.destination)

    this.#stream = stream
    this.#ctx = ctx
    this.#node = node
    liveInfo("mic-context", { requested: SAMPLE_RATE, actual: ctx.sampleRate })
  }

  async stop(): Promise<void> {
    if (this.#node) {
      this.#node.port.onmessage = null
      this.#node.disconnect()
      this.#node = null
    }
    if (this.#ctx && this.#ctx.state !== "closed") {
      await this.#ctx.close()
    }
    this.#ctx = null
    if (this.#stream) {
      for (const t of this.#stream.getTracks()) t.stop()
      this.#stream = null
    }
    this.#level = 0
  }
}
