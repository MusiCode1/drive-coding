// app.js — wires the library, both orbs, and the capture recorder together.

import { WakeWordDetector } from "./wake-word-lib.js";
import { createDomOrb } from "./orb-dom.js";
import { createCanvasOrb } from "./orb-canvas.js";
import { createCapture } from "./capture.js";

const toggleBtn = document.getElementById("toggle");
const statusEl = document.getElementById("status");

const domOrb = createDomOrb(document.getElementById("orb-dom"));
const canvasOrb = createCanvasOrb(document.getElementById("orb-canvas"));
const orbs = [domOrb, canvasOrb];

const capture = createCapture({
  clipsContainer: document.getElementById("cap-clips"),
  statusEl: document.getElementById("cap-status"),
  trimInput: document.getElementById("cap-trim"),
  onStart: () => orbs.forEach((o) => o.setCapturing(true)),
  onStop: () => orbs.forEach((o) => o.setCapturing(false)),
});

const detector = new WakeWordDetector({
  keywords: ["hey_jarvis"],
  baseAssetUrl: "assets/models",
});

// Library events → orbs + capture.
detector.on("level", (rms) => orbs.forEach((o) => o.setLevel(rms)));
detector.on("vadStart", () => orbs.forEach((o) => o.setVad(true)));
detector.on("vadEnd", () => orbs.forEach((o) => o.setVad(false)));
detector.on("detect", ({ keyword, score }) => {
  orbs.forEach((o) => o.flash());
  capture.onWakeWord(keyword, score);
});
detector.on("error", (e) => { console.error(e); statusEl.textContent = `error: ${e.message}`; });

// Feed raw frames to the capture recorder (the lib emits 'frame' per chunk).
detector.on("frame", (frame) => capture.pushFrame(frame));

let running = false;

toggleBtn.addEventListener("click", async () => {
  if (!running) {
    toggleBtn.disabled = true;
    try {
      await detector.start();
      running = true;
      toggleBtn.textContent = "Stop Listening";
      statusEl.textContent = "👂 listening — say \"hey jarvis\"";
    } catch (e) {
      statusEl.textContent = `start failed: ${e.message}`;
    } finally {
      toggleBtn.disabled = false;
    }
  } else {
    await detector.stop();
    running = false;
    orbs.forEach((o) => o.reset());
    toggleBtn.textContent = "Start Listening";
    statusEl.textContent = "stopped";
  }
});

// Load models on page open.
(async () => {
  try {
    await detector.load();
    toggleBtn.disabled = false;
    toggleBtn.textContent = "Start Listening";
    statusEl.textContent = "models loaded — ready";
  } catch (e) {
    statusEl.textContent = `model load failed: ${e.message}`;
  }
})();
