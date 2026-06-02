// wake-word-lib.js
//
// Reusable in-browser wake-word library, distilled from the DeepCoreLabs
// openWakeWord demo (deepcorelabs.com/projects/openwakeword). ES Module.
//
// Two levels of API:
//
//   HIGH-LEVEL — a ready-to-use class:
//     import { WakeWordDetector } from './wake-word-lib.js'
//     const det = new WakeWordDetector({ keywords: ['hey_jarvis'] })
//     det.on('level',    (rms)          => {})   // every frame, 0..~1
//     det.on('vadStart', ()            => {})    // speech segment begins
//     det.on('vadEnd',   ({ frames })  => {})    // speech segment ends
//     det.on('detect',   ({ keyword, score }) => {}) // wake word fired
//     await det.load(); await det.start();  // ... det.stop()
//
//   LOW-LEVEL primitives (compose your own pipeline / offline analysis):
//     loadModels, runMelspec, runEmbedding, runVad, runClassifier,
//     createScorePipeline, computeRms, createWavBlob, createMicStream,
//     AUDIO_PROCESSOR_CODE, SAMPLE_RATE, FRAME_SIZE, MODEL_FILE_MAP
//
// Requires `ort` (onnxruntime-web) to be available globally (loaded via a
// <script> tag) OR pass an `ort` instance into the functions that need it.

/* global ort */

// ─────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────

export const SAMPLE_RATE = 16000;
export const FRAME_SIZE = 1280; // samples per frame = 80ms @ 16kHz
export const VAD_THRESHOLD = 0.5;
export const DETECT_THRESHOLD = 0.5;

export const MODEL_FILE_MAP = {
  alexa: "alexa_v0.1.onnx",
  hey_mycroft: "hey_mycroft_v0.1.onnx",
  hey_jarvis: "hey_jarvis_v0.1.onnx",
  hey_rhasspy: "hey_rhasspy_v0.1.onnx",
  timer: "timer_v0.1.onnx",
  weather: "weather_v0.1.onnx",
};

// The AudioWorklet processor: buffers raw input into fixed FRAME_SIZE chunks
// and posts each chunk to the main thread.
export const AUDIO_PROCESSOR_CODE = `
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
`;

// ─────────────────────────────────────────────────────────────────────────
// Tiny event emitter
// ─────────────────────────────────────────────────────────────────────────

export function createEmitter() {
  const listeners = new Map();
  return {
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
      return () => listeners.get(event)?.delete(handler);
    },
    off(event, handler) {
      listeners.get(event)?.delete(handler);
    },
    emit(event, payload) {
      const set = listeners.get(event);
      if (set) for (const h of Array.from(set)) h(payload);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────────────────

/** RMS (loudness) of a frame, 0..~1. */
export function computeRms(chunk) {
  let sum = 0;
  for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
  return Math.sqrt(sum / chunk.length);
}

/**
 * Load the shared models (melspec, embedding, vad) plus one classifier per
 * keyword. Returns { melspec, embedding, vad, classifiers: {name: session} }.
 */
export async function loadModels({
  baseAssetUrl = "assets/models",
  keywords = ["hey_jarvis"],
  modelFiles = MODEL_FILE_MAP,
  executionProviders = ["wasm"],
  ortRef = typeof ort !== "undefined" ? ort : undefined,
} = {}) {
  if (!ortRef) throw new Error("onnxruntime-web (ort) not available");
  const base = baseAssetUrl.replace(/\/+$/, "");
  const opts = { executionProviders };
  const url = (f) => `${base}/${f}`;

  const [melspec, embedding, vad] = await Promise.all([
    ortRef.InferenceSession.create(url("melspectrogram.onnx"), opts),
    ortRef.InferenceSession.create(url("embedding_model.onnx"), opts),
    ortRef.InferenceSession.create(url("silero_vad.onnx"), opts),
  ]);

  const classifiers = {};
  for (const kw of keywords) {
    const file = modelFiles[kw];
    if (!file) throw new Error(`No model file for keyword "${kw}"`);
    classifiers[kw] = await ortRef.InferenceSession.create(url(file), opts);
  }
  return { melspec, embedding, vad, classifiers };
}

/** Fresh Silero VAD recurrent state ({h, c} tensors). */
export function createVadState(ortRef = ort) {
  const shape = [2, 1, 64];
  return {
    h: new ortRef.Tensor("float32", new Float32Array(128).fill(0), shape),
    c: new ortRef.Tensor("float32", new Float32Array(128).fill(0), shape),
  };
}

/**
 * Run one VAD step. Mutates `state` (h/c) in place. Returns the speech
 * probability (0..1). Compare against VAD_THRESHOLD for a boolean.
 */
export async function runVad(vadModel, chunk, state, ortRef = ort) {
  const tensor = new ortRef.Tensor("float32", chunk, [1, chunk.length]);
  const sr = new ortRef.Tensor("int64", [BigInt(SAMPLE_RATE)], []);
  const res = await vadModel.run({ input: tensor, sr, h: state.h, c: state.c });
  state.h = res.hn;
  state.c = res.cn;
  return res.output.data[0];
}

/**
 * Run the melspectrogram model on one frame. Returns 5 mel rows of 32 values,
 * already transformed by the required (x/10 + 2) formula. (AHA #1/#2)
 */
export async function runMelspec(melModel, chunk, ortRef = ort) {
  const tensor = new ortRef.Tensor("float32", chunk, [1, FRAME_SIZE]);
  const out = await melModel.run({ [melModel.inputNames[0]]: tensor });
  const data = out[melModel.outputNames[0]].data;
  for (let j = 0; j < data.length; j++) data[j] = data[j] / 10.0 + 2.0;
  const rows = [];
  for (let j = 0; j < 5; j++) {
    // Copy — ONNX reuses output buffers.
    rows.push(new Float32Array(data.subarray(j * 32, (j + 1) * 32)));
  }
  return rows;
}

/** Run the embedding model on a 76×32 mel window → 96-dim embedding. (AHA #3) */
export async function runEmbedding(embModel, melWindow76, ortRef = ort) {
  const flat = new Float32Array(76 * 32);
  for (let j = 0; j < melWindow76.length; j++) flat.set(melWindow76[j], j * 32);
  const feeds = { [embModel.inputNames[0]]: new ortRef.Tensor("float32", flat, [1, 76, 32, 1]) };
  const out = await embModel.run(feeds);
  return new Float32Array(out[embModel.outputNames[0]].data);
}

/** Run one keyword classifier on a 16×96 embedding window → score 0..1. (AHA #4) */
export async function runClassifier(clsModel, embWindow16, ortRef = ort) {
  const flat = new Float32Array(16 * 96);
  for (let j = 0; j < embWindow16.length; j++) flat.set(embWindow16[j], j * 96);
  const t = new ortRef.Tensor("float32", flat, [1, 16, 96]);
  const out = await clsModel.run({ [clsModel.inputNames[0]]: t });
  return out[clsModel.outputNames[0]].data[0];
}

/**
 * Build a stateful score pipeline that turns single frames into per-keyword
 * scores, managing the mel (76) and embedding (16) sliding windows internally.
 *
 * Returns { push(frame) -> Promise<{keyword: score}|null> , reset() }.
 * Returns null until the first 76-mel window fills; thereafter returns the
 * latest scores for every keyword on each emitting step.
 */
export function createScorePipeline({ melModel, embModel, classifiers, ortRef = ort }) {
  let melBuffer = [];
  let embBuffer = [];
  const initEmb = () => { embBuffer = []; for (let i = 0; i < 16; i++) embBuffer.push(new Float32Array(96).fill(0)); };
  initEmb();

  return {
    reset() { melBuffer = []; initEmb(); },
    async push(frame) {
      const rows = await runMelspec(melModel, frame, ortRef);
      for (const r of rows) melBuffer.push(r);

      let latest = null;
      while (melBuffer.length >= 76) {
        const window = melBuffer.slice(0, 76);
        const emb = await runEmbedding(embModel, window, ortRef);
        embBuffer.shift();
        embBuffer.push(emb);

        latest = {};
        for (const name in classifiers) {
          latest[name] = await runClassifier(classifiers[name], embBuffer, ortRef);
        }
        melBuffer.splice(0, 8); // hop
      }
      return latest;
    },
  };
}

/** PCM Float32 frames → 16-bit mono WAV Blob. */
export function createWavBlob(frames, sampleRate = SAMPLE_RATE) {
  const total = frames.reduce((n, f) => n + f.length, 0);
  if (total === 0) return null;
  const combined = new Float32Array(total);
  let off = 0;
  for (const f of frames) { combined.set(f, off); off += f.length; }
  const pcm = new Int16Array(total);
  for (let i = 0; i < total; i++) {
    const s = Math.max(-1, Math.min(1, combined[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const ch = 1, bits = 16;
  v.setUint32(0, 0x52494646, false);
  v.setUint32(4, 36 + pcm.byteLength, true);
  v.setUint32(8, 0x57415645, false);
  v.setUint32(12, 0x666d7420, false);
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * ch * (bits / 8), true);
  v.setUint16(32, ch * (bits / 8), true);
  v.setUint16(34, bits, true);
  v.setUint32(36, 0x64617461, false);
  v.setUint32(40, pcm.byteLength, true);
  return new Blob([v, pcm], { type: "audio/wav" });
}

/** Convenience: WAV Blob → object URL (caller revokes when done). */
export function createWavBlobUrl(frames, sampleRate = SAMPLE_RATE) {
  const blob = createWavBlob(frames, sampleRate);
  return blob ? URL.createObjectURL(blob) : null;
}

/**
 * Open a 16kHz mic stream and route it through the AudioWorklet, invoking
 * `onFrame(Float32Array)` for every FRAME_SIZE chunk. Returns a handle with
 * setGain(v) and stop().
 */
export async function createMicStream({ deviceId, gain = 1.0, onFrame } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: deviceId ? { deviceId: { exact: deviceId } } : true,
  });
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  const source = ctx.createMediaStreamSource(stream);
  const gainNode = ctx.createGain();
  gainNode.gain.value = gain;

  const blob = new Blob([AUDIO_PROCESSOR_CODE], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  await ctx.audioWorklet.addModule(url);
  const node = new AudioWorkletNode(ctx, "audio-processor");
  node.port.onmessage = (e) => { if (e.data && onFrame) onFrame(e.data); };

  source.connect(gainNode);
  gainNode.connect(node);
  node.connect(ctx.destination);

  return {
    setGain(v) { gainNode.gain.value = v; },
    async stop() {
      node.port.onmessage = null;
      node.disconnect();
      gainNode.disconnect();
      if (ctx.state !== "closed") await ctx.close();
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// High-level: WakeWordDetector
// ─────────────────────────────────────────────────────────────────────────

/**
 * Ready-to-use detector. Loads models, opens the mic, runs VAD + classifiers,
 * and emits events. Emits 'detect' only when score>threshold AND VAD active
 * AND not in cooldown — matching the reference demo's gating.
 *
 * Events: 'ready', 'frame'(Float32Array), 'level'(rms), 'vadStart',
 *         'vadEnd'({frames}), 'detect'({keyword, score, sinceVadStart}),
 *         'score'({scores}), 'error'(err)
 */
export class WakeWordDetector {
  constructor({
    keywords = ["hey_jarvis"],
    baseAssetUrl = "assets/models",
    detectionThreshold = DETECT_THRESHOLD,
    vadThreshold = VAD_THRESHOLD,
    vadHangoverFrames = 12,
    cooldownMs = 2000,
    gain = 1.0,
    ortRef = typeof ort !== "undefined" ? ort : undefined,
  } = {}) {
    this.config = { keywords, baseAssetUrl, detectionThreshold, vadThreshold, vadHangoverFrames, cooldownMs, gain };
    this._ort = ortRef;
    this._emitter = createEmitter();
    this._models = null;
    this._pipeline = null;
    this._vadState = null;
    this._mic = null;
    this._loaded = false;

    // runtime state
    this._frame = 0;
    this._isSpeech = false;
    this._hangover = 0;
    this._vadStartFrame = null;
    this._cooling = false;
    this._queue = Promise.resolve();
  }

  on(event, handler) { return this._emitter.on(event, handler); }
  off(event, handler) { this._emitter.off(event, handler); }
  get frameIndex() { return this._frame; }

  async load() {
    if (this._loaded) return;
    if (!this._ort) throw new Error("onnxruntime-web (ort) not available");
    this._models = await loadModels({
      baseAssetUrl: this.config.baseAssetUrl,
      keywords: this.config.keywords,
      ortRef: this._ort,
    });
    this._pipeline = createScorePipeline({
      melModel: this._models.melspec,
      embModel: this._models.embedding,
      classifiers: this._models.classifiers,
      ortRef: this._ort,
    });
    this._vadState = createVadState(this._ort);
    this._loaded = true;
    this._emitter.emit("ready");
  }

  async start() {
    if (!this._loaded) throw new Error("call load() before start()");
    if (this._mic) return;
    this._resetRuntime();
    this._mic = await createMicStream({
      gain: this.config.gain,
      onFrame: (frame) => {
        // Serialize async processing so frames don't interleave.
        this._queue = this._queue.then(() => this._onFrame(frame)).catch((e) => this._emitter.emit("error", e));
      },
    });
  }

  async stop() {
    if (this._mic) { await this._mic.stop(); this._mic = null; }
  }

  setGain(v) { this._mic?.setGain(v); }

  _resetRuntime() {
    this._frame = 0;
    this._isSpeech = false;
    this._hangover = 0;
    this._vadStartFrame = null;
    this._cooling = false;
    this._pipeline?.reset();
    this._vadState = createVadState(this._ort);
  }

  async _onFrame(frame) {
    this._frame++;

    // (0) raw frame — for consumers that need the PCM (e.g. recording)
    this._emitter.emit("frame", frame);

    // (1) loudness — always
    this._emitter.emit("level", computeRms(frame));

    // (2) VAD
    const prob = await runVad(this._models.vad, frame, this._vadState, this._ort);
    const speaking = prob > this.config.vadThreshold;
    if (speaking) {
      if (!this._isSpeech) { this._vadStartFrame = this._frame; this._emitter.emit("vadStart"); }
      this._isSpeech = true;
      this._hangover = this.config.vadHangoverFrames;
    } else if (this._isSpeech) {
      this._hangover--;
      if (this._hangover <= 0) {
        this._isSpeech = false;
        const frames = this._vadStartFrame != null ? this._frame - this._vadStartFrame : null;
        this._emitter.emit("vadEnd", { frames });
      }
    }

    // (3) scores → detect (gated by VAD + cooldown)
    const scores = await this._pipeline.push(frame);
    if (scores) {
      this._emitter.emit("score", { scores });
      for (const name in scores) {
        const score = scores[name];
        if (score > this.config.detectionThreshold && this._isSpeech && !this._cooling) {
          this._cooling = true;
          const since = this._vadStartFrame != null ? this._frame - this._vadStartFrame : null;
          this._emitter.emit("detect", { keyword: name, score, sinceVadStart: since });
          setTimeout(() => { this._cooling = false; }, this.config.cooldownMs);
        }
      }
    }
  }
}
