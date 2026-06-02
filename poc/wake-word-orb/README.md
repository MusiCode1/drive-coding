# Voice Orb POC

Third wake-word POC. Goal: a clean reusable **library** plus a minimal UI — a
single **voice-reactive orb that is also the start/stop button**, plus recording
playback. (An earlier Canvas variant was dropped: its rAF motion felt lower-fps
and less smooth than CSS; the DOM/CSS orb won.)

## The orb

The orb is the only control — tap it to start/stop listening. Its appearance
encodes the state and the live audio:

| Aspect | Source | Visual |
|--------|--------|--------|
| Mode | off / listening / recording | base **color**: grey / blue / red (long ~300ms transition) |
| Loudness | RMS per frame | orb **size** + **darkening** (louder = darker), smoothed in JS, short ~80ms transition |
| Wake word | detect event | white **flash** pulse |

Plus: a **start cue** (high beep) when recording begins, an **end cue** (low
beep) when it stops, and the captured clip **auto-plays ~1s after** the end cue.

### Smoothing — why two transition speeds

Loudness updates every frame (~12.5×/s), so its smoothing is done in JS (lerp)
with only a short CSS transition to bridge frame steps. Mode color changes only
on events, so it gets a longer, nicer CSS transition. They sit on *different* CSS
properties (`background-color` for mode vs `filter: brightness` for loudness) so
the two timings never fight — a long transition on a per-frame value would lag
and look "wrong".

## Files

| File | Role |
|------|------|
| `wake-word-lib.js` | **The library.** ES module, two levels: <br>• High-level `WakeWordDetector` class (load → start → emits `frame`/`level`/`vadStart`/`vadEnd`/`detect`/`score`). <br>• Low-level primitives: `loadModels`, `runMelspec`, `runEmbedding`, `runVad`, `runClassifier`, `createScorePipeline`, `computeRms`, `createWavBlob(Url)`, `createMicStream`, `createEmitter`, plus constants (`SAMPLE_RATE`, `FRAME_SIZE`, `MODEL_FILE_MAP`). Reusable by any POC. |
| `orb-dom.js` | DOM/CSS orb + button. `createDomOrb(el, {onClick})` → `setLevel/setState/flash/reset`. |
| `capture.js` | Wake-to-wake recorder built on the lib's `createWavBlobUrl`; `onStop(url)` hands back the clip; `abort()` stops without saving. |
| `app.js` | Wires detector → orb + capture, cue tones, delayed auto-play, orb-as-button toggle. |
| `index.html` | Minimal UI: the orb (which is the button) + recordings. |

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

Tap the orb (grey) to start listening (blue). Say "hey jarvis" → start cue +
orb turns red (recording). Say "hey jarvis" again → end cue, orb back to blue,
and the clip auto-plays after ~1s (also saved under Recordings). Tap the orb any
time to stop everything (mid-recording = discards without saving).

## Verified (headless)

Models load; orb builds (grey idle, role=button). Confirmed: state colors
grey→blue→red→grey; size grows with RMS (90→216px) and brightness darkens
(1→0.61) when louder; orb click fires the toggle; flash adds the pulse; capture
`onStop` returns a blob URL (for auto-play); `abort()` stops without saving a
clip. Live mic + cue audio not auto-tested (no mic/audio device in headless env).

## Caveats

English keywords only (`hey_jarvis` etc.). Hebrew needs a trained `.onnx` (see
`docs/investigations/wake-word-client-side.md` §5, track D). The library is the
reusable artifact intended to back slice 17.

## Event stream log

A log box prints each event with a timestamp (seconds + frame #): VAD
start/end (with segment length), DETECT (with score + offset after VAD start),
and capture start/stop. Useful for inspecting timing and debugging.
