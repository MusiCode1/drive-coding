// app.js — wires the library + the (single) DOM orb + capture recorder.
// The orb itself is the start/stop button.

import { WakeWordDetector } from "./wake-word-lib.js";
import { createDomOrb } from "./orb-dom.js";
import { createCapture } from "./capture.js";

const statusEl = document.getElementById("status");

// ── Cue tones (start / end) via a shared AudioContext ──────────────────────
const cueCtx = new (window.AudioContext || window.webkitAudioContext)();
function tone(freq, durMs, type = "sine") {
  if (cueCtx.state === "suspended") cueCtx.resume();
  const osc = cueCtx.createOscillator();
  const gain = cueCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, cueCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.18, cueCtx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, cueCtx.currentTime + durMs / 1000);
  osc.connect(gain); gain.connect(cueCtx.destination);
  osc.start();
  osc.stop(cueCtx.currentTime + durMs / 1000 + 0.02);
}
const cueStart = () => tone(880, 160);   // higher → "go"
const cueEnd = () => tone(440, 220);     // lower  → "done"

// ── Orb (single, DOM) — also the start/stop button ─────────────────────────
let running = false;

const orb = createDomOrb(document.getElementById("orb-dom"), {
  onClick: () => toggleListening(),
});

// ── Capture recorder ───────────────────────────────────────────────────────
const capture = createCapture({
  clipsContainer: document.getElementById("cap-clips"),
  statusEl: document.getElementById("cap-status"),
  trimInput: document.getElementById("cap-trim"),
  onStart: () => {
    cueStart();
    orb.setState("recording");
  },
  onStop: (url) => {
    cueEnd();
    orb.setState("listening"); // back to listening (mic still on)
    // Wait ~1s after the end cue, then play back the captured clip.
    if (url) {
      setTimeout(() => { new Audio(url).play().catch(() => {}); }, 1000);
    }
  },
});

// ── Detector ────────────────────────────────────────────────────────────────
const detector = new WakeWordDetector({
  keywords: ["hey_jarvis"],
  baseAssetUrl: "assets/models",
});

// ── Event-stream log ────────────────────────────────────────────────────────
const logBox = document.getElementById("event-log");
document.getElementById("log-clear").addEventListener("click", () => { logBox.innerHTML = ""; });
function logEvent(text, cls) {
  const secs = (detector.frameIndex * 1280 / 16000).toFixed(2);
  const line = document.createElement("div");
  if (cls) line.className = cls;
  line.textContent = `t=${secs}s  f#${detector.frameIndex}  ${text}`;
  logBox.appendChild(line);
  logBox.scrollTop = logBox.scrollHeight;
}

detector.on("level", (rms) => orb.setLevel(rms));

// THE FIX: feed raw frames to the recorder (this wiring was missing — every
// capture came out empty because the buffer was never fed).
detector.on("frame", (frame) => capture.pushFrame(frame));

detector.on("vadStart", () => logEvent("VAD ▶ speech start", "ev-vad-start"));
detector.on("vadEnd", ({ frames }) =>
  logEvent(`VAD ■ speech end (segment ${frames} frames ≈ ${(frames * 1280 / 16000).toFixed(2)}s)`, "ev-vad-end"));

detector.on("detect", ({ keyword, score, sinceVadStart }) => {
  const since = sinceVadStart != null ? ` — ${sinceVadStart} frames (≈${(sinceVadStart * 1280 / 16000).toFixed(2)}s) after VAD start` : "";
  logEvent(`DETECT ★ "${keyword}" score=${score.toFixed(2)}${since}`, "ev-detect");
  orb.flash();
  capture.onWakeWord(keyword, score);
  logEvent(capture.capturing ? "capture STARTED (wake #1)" : "capture STOPPED (wake #2)", "ev-cap");
});
detector.on("error", (e) => { console.error(e); statusEl.textContent = `error: ${e.message}`; logEvent(`ERROR: ${e.message}`, "ev-detect"); });

// ── Listening toggle (driven by tapping the orb) ─────────────────────────────
async function toggleListening() {
  if (running) {
    // Tapping while running always shuts everything down (incl. mid-recording).
    capture.abort();
    await detector.stop();
    running = false;
    orb.reset(); // grey
    statusEl.textContent = "off — tap the orb to listen";
    return;
  }
  // start
  statusEl.textContent = "starting…";
  try {
    await detector.start();
    running = true;
    orb.setState("listening"); // blue
    statusEl.textContent = "👂 listening — say \"hey jarvis\"";
  } catch (e) {
    statusEl.textContent = `start failed: ${e.message}`;
  }
}

// ── Load models on open ──────────────────────────────────────────────────────
(async () => {
  statusEl.textContent = "loading models…";
  try {
    await detector.load();
    statusEl.textContent = "ready — tap the orb to listen";
  } catch (e) {
    statusEl.textContent = `model load failed: ${e.message}`;
  }
})();
