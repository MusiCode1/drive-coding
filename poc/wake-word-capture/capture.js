// capture.js — the NEW functionality layered on top of the original DeepCoreLabs main.js.
//
// Flow we want:
//   wake word #1 ("hey jarvis")  -> beep -> START accumulating raw audio frames
//   [user speaks freely, INCLUDING pauses to think — silence does NOT stop]
//   wake word #2 ("hey jarvis")  -> STOP -> build a WAV of everything in between
//
// main.js exposes two hooks we listen on:
//   window.onAudioChunk(chunk)     — every raw 1280-sample Float32 frame
//   window.onWakeWord(name, score) — fires when a wake word is detected
//
// We do NOT use the VAD for stopping (a thinking pause must not cut the user off).
// The VAD still runs inside main.js as a detection gate + live debug display.

document.addEventListener("DOMContentLoaded", () => {
  const SAMPLE_RATE = 16000;
  const FRAME = 1280; // samples per chunk (80ms)

  // How many trailing frames to drop when stopping, to remove the 2nd wake word
  // from the recording. The detect fires late (classifier window), so the word
  // sits in roughly the last ~1.3s. 16 frames ≈ 1.28s. Tunable from the UI.
  const DEFAULT_TRIM_FRAMES = 16;

  const capStatus = document.getElementById("cap-status");
  const capClips = document.getElementById("cap-clips");
  const trimInput = document.getElementById("cap-trim");
  const logBox = document.getElementById("event-log");
  const logClearBtn = document.getElementById("log-clear");

  let capturing = false;
  let buffer = []; // Float32Array frames accumulated between wake words

  // Global frame counter (every onAudioChunk = 1 frame = 80ms). Lets us show
  // *when* events happen and how far apart, in frames and seconds.
  let frameCount = 0;
  let lastVadStartFrame = null;

  function setStatus(text) {
    if (capStatus) capStatus.textContent = text;
  }

  // Append a line to the event-stream log box.
  function logEvent(text, cls) {
    if (!logBox) return;
    const secs = (frameCount * FRAME / SAMPLE_RATE).toFixed(2);
    const line = document.createElement("div");
    if (cls) line.className = cls;
    line.textContent = `t=${secs}s  f#${frameCount}  ${text}`;
    logBox.appendChild(line);
    logBox.scrollTop = logBox.scrollHeight;
  }

  if (logClearBtn) logClearBtn.addEventListener("click", () => { logBox.innerHTML = ""; });

  // Same WAV encoder as the original main.js createWavBlobUrl, kept standalone here.
  function framesToWavUrl(frames) {
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
    const channels = 1, bits = 16;
    const byteRate = SAMPLE_RATE * channels * (bits / 8);
    const blockAlign = channels * (bits / 8);
    v.setUint32(0, 0x52494646, false);            // "RIFF"
    v.setUint32(4, 36 + pcm.byteLength, true);
    v.setUint32(8, 0x57415645, false);            // "WAVE"
    v.setUint32(12, 0x666d7420, false);           // "fmt "
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, channels, true);
    v.setUint32(24, SAMPLE_RATE, true);
    v.setUint32(28, byteRate, true);
    v.setUint16(32, blockAlign, true);
    v.setUint16(34, bits, true);
    v.setUint32(36, 0x64617461, false);           // "data"
    v.setUint32(40, pcm.byteLength, true);
    return URL.createObjectURL(new Blob([v, pcm], { type: "audio/wav" }));
  }

  // A short start beep so the user knows to begin speaking AFTER it.
  function beep() {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.15;
      osc.connect(gain); gain.connect(ac.destination);
      osc.start();
      osc.stop(ac.currentTime + 0.15);
      osc.onended = () => ac.close();
    } catch (_) { /* ignore */ }
  }

  function startCapture() {
    capturing = true;
    buffer = [];
    beep();
    setStatus("🔴 recording — speak now. Say the wake word again to stop.");
  }

  function stopCapture() {
    capturing = false;
    const trim = Math.max(0, parseInt(trimInput?.value ?? DEFAULT_TRIM_FRAMES, 10) || 0);
    // Drop the trailing frames that contain the 2nd wake word.
    const kept = trim > 0 ? buffer.slice(0, Math.max(0, buffer.length - trim)) : buffer.slice();
    const secs = (kept.reduce((n, f) => n + f.length, 0) / SAMPLE_RATE).toFixed(1);
    const url = framesToWavUrl(kept);
    if (url) {
      const wrap = document.createElement("div");
      wrap.className = "cap-clip";
      const title = document.createElement("p");
      title.textContent = `Captured ${secs}s (trimmed ${trim} frames ≈ ${(trim * FRAME / SAMPLE_RATE).toFixed(2)}s from end) @ ${new Date().toLocaleTimeString()}`;
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.src = url;
      const dl = document.createElement("a");
      dl.href = url;
      dl.download = `capture-${Date.now()}.wav`;
      dl.textContent = " download";
      wrap.appendChild(title);
      wrap.appendChild(audio);
      wrap.appendChild(dl);
      capClips.appendChild(wrap);
    } else {
      setStatus("⚠️ nothing captured (recording was empty after trim).");
      return;
    }
    setStatus("✅ saved. Say the wake word to record again.");
    buffer = [];
  }

  // --- Hooks consumed from main.js ---
  window.onAudioChunk = (chunk) => {
    frameCount++;
    if (capturing) {
      // Copy: ONNX/worklet buffers get reused, so we must clone before storing.
      buffer.push(new Float32Array(chunk));
    }
  };

  window.onVadStart = () => {
    lastVadStartFrame = frameCount;
    logEvent("VAD ▶ speech start", "ev-vad-start");
  };

  window.onVadEnd = () => {
    const dur = lastVadStartFrame != null ? frameCount - lastVadStartFrame : null;
    const durTxt = dur != null ? ` (segment ${dur} frames ≈ ${(dur * FRAME / SAMPLE_RATE).toFixed(2)}s)` : "";
    logEvent(`VAD ■ speech end${durTxt}`, "ev-vad-end");
  };

  window.onWakeWord = (name, score) => {
    // Show how late the detect fired relative to the current VAD segment start —
    // this is the "latency" the fixed trim compensates for.
    const since = lastVadStartFrame != null ? frameCount - lastVadStartFrame : null;
    const sinceTxt = since != null
      ? ` — ${since} frames (≈${(since * FRAME / SAMPLE_RATE).toFixed(2)}s) after VAD start`
      : "";
    logEvent(`DETECT ★ "${name}" score=${score.toFixed(2)}${sinceTxt}`, "ev-detect");

    if (!capturing) {
      startCapture();
      logEvent("capture STARTED (wake #1)", "ev-cap");
    } else {
      stopCapture();
      logEvent("capture STOPPED (wake #2)", "ev-cap");
    }
  };

  setStatus("idle — start listening above, then say the wake word to begin a capture.");
  if (logBox) logEvent("ready — waiting for events", "ev-cap");
});
