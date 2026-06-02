// capture.js — wake-to-wake recorder, built on wake-word-lib primitives.
//
// detect #1 -> start accumulating raw frames -> detect #2 -> WAV.
// Silence does NOT stop (the user may pause to think). The 2nd wake word is
// trimmed off by dropping a fixed number of trailing frames.

import { createWavBlobUrl, FRAME_SIZE, SAMPLE_RATE } from "./wake-word-lib.js";

export function createCapture({ clipsContainer, statusEl, trimInput, onStart, onStop }) {
  let capturing = false;
  let buffer = [];

  const setStatus = (t) => { if (statusEl) statusEl.textContent = t; };
  const trimFrames = () => Math.max(0, parseInt(trimInput?.value ?? 16, 10) || 0);

  function pushFrame(frame) {
    if (capturing) buffer.push(new Float32Array(frame)); // copy: worklet reuses buffers
  }

  function start() {
    capturing = true;
    buffer = [];
    setStatus("🔴 recording — speak now. Say the wake word again to stop.");
    onStart?.();
  }

  function stop() {
    capturing = false;
    const trim = trimFrames();
    const kept = trim > 0 ? buffer.slice(0, Math.max(0, buffer.length - trim)) : buffer.slice();
    const secs = (kept.reduce((n, f) => n + f.length, 0) / SAMPLE_RATE).toFixed(1);
    const url = createWavBlobUrl(kept, SAMPLE_RATE);
    if (url && clipsContainer) {
      const wrap = document.createElement("div");
      wrap.className = "clip";
      const p = document.createElement("p");
      p.textContent = `Captured ${secs}s (trimmed ${trim} frames ≈ ${(trim * FRAME_SIZE / SAMPLE_RATE).toFixed(2)}s) @ ${new Date().toLocaleTimeString()}`;
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.src = url;
      const dl = document.createElement("a");
      dl.href = url;
      dl.download = `capture-${Date.now()}.wav`;
      dl.textContent = "download";
      wrap.append(p, audio, dl);
      clipsContainer.appendChild(wrap);
    }
    setStatus(url ? "✅ saved. Say the wake word to record again." : "⚠️ empty capture.");
    buffer = [];
    onStop?.();
  }

  // Called on each detect: toggles start/stop.
  function onWakeWord() {
    if (!capturing) start(); else stop();
  }

  return { pushFrame, onWakeWord, get capturing() { return capturing; } };
}
