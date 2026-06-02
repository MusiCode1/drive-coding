# Wake Word POC — in-browser openWakeWord

A throwaway proof-of-concept: open mic in the browser, detect a spoken keyword
fully client-side (no backend, no cloud), and flash a banner on screen.

Validates the core feasibility behind `docs/investigations/wake-word-client-side.md`
(track "C-new") before committing to slice 17.

## What it uses

- [`dnavarrom/openwakeword_wasm`](https://github.com/dnavarrom/openwakeword_wasm)
  (`openwakeword-wasm-browser@0.1.0`, MIT) — wraps the openWakeWord ONNX pipeline
  (melspectrogram → embedding → Silero VAD → keyword classifier) in an `AudioWorklet`.
- `onnxruntime-web@1.23.2` from a CDN (via an import map), single-threaded WASM
  (avoids the COOP/COEP cross-origin-isolation requirement).
- Pre-trained English keyword models: `hey_jarvis`, `alexa`, `hey_mycroft`,
  `hey_rhasspy`, `timer`, `weather`. **No Hebrew** — that needs a trained `.onnx`
  (see investigation §5, future track D).

## Layout

```
poc/wake-word/
  index.html        # UI (tracked)
  poc.js            # engine wiring + events (tracked)
  fetch-assets.sh   # downloads engine + models (tracked)
  README.md         # this file (tracked)
  .gitignore        # ignores assets/
  assets/           # GITIGNORED — binaries, restore via fetch-assets.sh
    vendor/package/src/WakeWordEngine.js
    models/*.onnx
    hey_jarvis_11-2.wav
```

## Run

```bash
./fetch-assets.sh                 # one-time: pull engine + models (~16MB)
python3 -m http.server 8080       # getUserMedia needs localhost/https
# open http://localhost:8080/
```

1. Pick a keyword (default `hey jarvis`).
2. **Start listening** → grant mic → say the keyword → green banner + score.
3. **Test with sample WAV** runs the whole pipeline offline (no mic needed) on
   the bundled `hey_jarvis` clip — a sanity check.

## Verified

Offline pipeline check via `runWav()` on `hey_jarvis_11-2.wav` returned
**highest score 0.999** (Chrome, single-thread WASM, CDN onnxruntime). The full
detection chain runs in-browser as expected.

Live-mic detection was not auto-tested (no physical mic in the headless env) —
run the Start button locally to confirm.
