# Voice Orb POC — DOM vs Canvas

Third wake-word POC. Goal: a clean reusable **library** plus a minimal UI with a
single button, a **voice-reactive orb indicator**, and recording playback. Two
orb implementations (DOM/CSS and Canvas) run side by side for comparison.

## The orb

One indicator reflects three signals at once:

| Signal | Source | Visual |
|--------|--------|--------|
| Loudness | RMS per frame | orb **size** (smoothed) |
| Speaking (VAD) | speech prob > 0.5 | orb **color** (blue → green) |
| Capturing | between wake words | red **ring** around the orb |
| Wake word | detect event | white **flash** pulse |

## Files

| File | Role |
|------|------|
| `wake-word-lib.js` | **The library.** ES module, two levels: <br>• High-level `WakeWordDetector` class (load → start → emits `frame`/`level`/`vadStart`/`vadEnd`/`detect`/`score`). <br>• Low-level primitives: `loadModels`, `runMelspec`, `runEmbedding`, `runVad`, `runClassifier`, `createScorePipeline`, `computeRms`, `createWavBlob(Url)`, `createMicStream`, `createEmitter`, plus constants (`SAMPLE_RATE`, `FRAME_SIZE`, `MODEL_FILE_MAP`). Reusable by any POC. |
| `orb-dom.js` | DOM/CSS orb. `createDomOrb(el)` → `setLevel/setVad/setCapturing/flash/reset`. |
| `orb-canvas.js` | Canvas orb, same API, adds expanding sound ripples + glow. |
| `capture.js` | Wake-to-wake recorder built on the lib's `createWavBlobUrl`. |
| `app.js` | Wires detector → both orbs + capture. |
| `index.html` | Minimal UI: button, two orbs, recordings. No charts/debug clutter. |

## Library usage (the point of this POC)

High-level, one-liner:

```js
import { WakeWordDetector } from './wake-word-lib.js'
const det = new WakeWordDetector({ keywords: ['hey_jarvis'], baseAssetUrl: 'assets/models' })
det.on('detect', ({ keyword, score }) => console.log('heard', keyword, score))
det.on('level', rms => updateMyUi(rms))
await det.load(); await det.start()
```

Low-level, compose your own (e.g. offline WAV scoring):

```js
import { loadModels, createScorePipeline, computeRms } from './wake-word-lib.js'
const m = await loadModels({ keywords: ['hey_jarvis'] })
const pipe = createScorePipeline({ melModel: m.melspec, embModel: m.embedding, classifiers: m.classifiers })
const scores = await pipe.push(frame) // {hey_jarvis: 0.93} once windows fill
```

(`ort` / onnxruntime-web must be loaded globally, or passed as `ortRef`.)

## Run

```bash
./fetch-assets.sh                 # one-time: pull ONNX models (~10MB)
python3 -m http.server 8080       # getUserMedia needs localhost/https
# open http://localhost:8080/
```

Say "hey jarvis" to start a capture, "hey jarvis" again to stop. Watch both orbs
react; the saved clip appears under Recordings.

## Verified (headless)

Models load; both orbs build. Simulated event chain confirmed: size grows with
RMS (0.2 → 121px), color flips on VAD, red ring toggles with capture, flash fires
on detect, and a trimmed WAV clip is produced. Live mic not auto-tested (no mic in
the headless env).

## Caveats

English keywords only (`hey_jarvis` etc.). Hebrew needs a trained `.onnx` (see
`docs/investigations/wake-word-client-side.md` §5, track D). The library is the
reusable artifact intended to back slice 17.
