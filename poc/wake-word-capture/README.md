# Wake-to-Wake Capture POC

Second wake-word POC. Goal: record the audio **between** two utterances of the
wake word, so the user controls start/stop by voice — and silence/thinking
pauses do **not** end the recording.

## Flow

```
"hey jarvis"  → 🔔 beep → [speak freely, pauses are fine] → "hey jarvis" → stop → WAV
   detect #1     START                                         detect #2     + audio player
```

- **Start** is clean at the audio level: recording begins on detect #1, after the
  beep, so the first wake word is never in the buffer.
- **Stop** is by the *second* wake word, never by silence. A thinking pause keeps
  recording. The 2nd wake word lands in the tail of the buffer, so we trim a fixed
  number of trailing frames (default 16 ≈ 1.28s, tunable in the UI). Good enough
  for a POC; a production version could trim by detect timestamp or post-filter
  the STT transcript instead.

## How it's built

Layered on the **original DeepCoreLabs demo**, deliberately keeping their code intact:

- `main.js` — the original `main.js` from `deepcorelabs.com/projects/openwakeword/package.zip`,
  **unchanged** except: (1) model/asset paths repointed to `assets/`, (2) two added
  hooks — `window.onAudioChunk(chunk)` (every raw frame) and `window.onWakeWord(name, score)`
  (on detection). It still does its original thing: live VAD indicator, score chart,
  and per-utterance debug audio clips.
- `style.css` — original, unchanged.
- `capture.js` — **the new logic**. Listens on the two hooks, accumulates frames
  between wake words, beeps on start, builds a WAV on the second wake word (reusing
  the same Int16 PCM encoder as the original `createWavBlobUrl`).
- `index.html` — extracted from the original `index.php` (PHP backend-switcher
  removed, WASM backend hardcoded), plus a capture section wired to `capture.js`.

## Why this approach (vs the first POC)

The first POC (`../wake-word/`) uses the `openwakeword-wasm-browser` npm wrapper,
which classifies and discards audio — it never exposes the raw PCM. This POC uses
the original demo, which **already buffers raw frames** (`utteranceBuffer` +
`createWavBlobUrl`). That makes "save the audio between wake words" a small addition
rather than a fight against the wrapper.

## Run

```bash
./fetch-assets.sh                 # one-time: pull models + WAV + success.mp3 (~16MB)
python3 -m http.server 8080       # getUserMedia needs localhost/https
# open http://localhost:8080/
```

1. **Start Listening** → grant mic.
2. Say **"hey jarvis"** → beep → speak (pause to think if you want).
3. Say **"hey jarvis"** again → a clip appears under "Wake-to-wake capture".
4. Play it back / download. Adjust "Trim trailing frames" if the 2nd word leaks in.

## Known caveats

- **Cooldown**: the engine has a 2s detection cooldown, so the *minimum* capture
  is ~2s and two wake words faster than 2s apart won't both fire. Fine for a POC.
- **English only** — `hey_jarvis` / `alexa` / `hey_mycroft`. Hebrew needs a trained
  `.onnx` (see `docs/investigations/wake-word-client-side.md` §5, track D).
- Trim is a fixed frame count, not aligned to the actual word boundary.
