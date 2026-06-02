// Wake Word POC — drives openWakeWord's WakeWordEngine entirely in the browser.
// The engine source lives (gitignored) under ./assets/vendor/package/src/.
// Run fetch-assets.sh first to populate ./assets/.

import * as ort from "onnxruntime-web";
import { WakeWordEngine } from "./assets/vendor/package/src/WakeWordEngine.js";

// Single-threaded WASM avoids the COOP/COEP cross-origin-isolation requirement.
ort.env.wasm.numThreads = 1;
ort.env.wasm.simd = true;

const $ = (id) => document.getElementById(id);
const statusEl = $("status");
const bannerEl = $("banner");
const meterFill = $("meterFill");
const logEl = $("log");
const startBtn = $("start");
const stopBtn = $("stop");
const testBtn = $("testWav");
const keywordSel = $("keyword");

let engine = null;
let bannerTimer = null;

function log(msg, cls = "") {
  const t = new Date().toLocaleTimeString();
  const line = document.createElement("div");
  if (cls) line.className = cls;
  line.textContent = `[${t}] ${msg}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function setStatus(text) {
  statusEl.textContent = text;
}

function flashBanner(keyword, score) {
  bannerEl.textContent = `✅ heard "${keyword.replace(/_/g, " ")}"  (${score.toFixed(2)})`;
  bannerEl.classList.add("show");
  meterFill.style.width = `${Math.min(100, score * 100)}%`;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => {
    bannerEl.classList.remove("show");
    meterFill.style.width = "0%";
  }, 2500);
}

async function buildEngine() {
  const keyword = keywordSel.value;
  const e = new WakeWordEngine({
    baseAssetUrl: "./assets/models",
    keywords: [keyword],
    detectionThreshold: 0.5,
    cooldownMs: 2000,
    debug: false,
  });
  e.on("ready", () => log("models loaded — engine ready"));
  e.on("speech-start", () => { setStatus("🗣️ speech detected…"); log("speech-start", "speech"); });
  e.on("speech-end", () => { setStatus("👂 listening…"); log("speech-end", "speech"); });
  e.on("detect", ({ keyword, score }) => {
    log(`DETECT: ${keyword} score=${score.toFixed(3)}`);
    flashBanner(keyword, score);
  });
  e.on("error", (err) => { log(`ERROR: ${err?.message ?? err}`); setStatus("⚠️ error — see log"); });
  return e;
}

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  keywordSel.disabled = true;
  try {
    setStatus("loading ONNX models…");
    log(`loading models for "${keywordSel.value}"…`);
    engine = await buildEngine();
    await engine.load();
    setStatus("requesting microphone…");
    await engine.start({ gain: 1.2 });
    setStatus("👂 listening… say the keyword");
    log("microphone started — say the keyword");
    stopBtn.disabled = false;
  } catch (err) {
    log(`startup failed: ${err?.message ?? err}`);
    setStatus("⚠️ startup failed — see log");
    startBtn.disabled = false;
    keywordSel.disabled = false;
  }
});

stopBtn.addEventListener("click", async () => {
  stopBtn.disabled = true;
  try { await engine?.stop(); } catch {}
  setStatus("stopped");
  log("engine stopped");
  startBtn.disabled = false;
  keywordSel.disabled = false;
});

// Offline sanity check: run the bundled sample WAV through the pipeline.
testBtn.addEventListener("click", async () => {
  testBtn.disabled = true;
  try {
    setStatus("loading models for WAV test…");
    const e = await buildEngine();
    await e.load();
    log("fetching sample WAV (hey_jarvis_11-2.wav)…");
    const buf = await (await fetch("./assets/hey_jarvis_11-2.wav")).arrayBuffer();
    const highest = await e.runWav(buf);
    log(`runWav highest score = ${highest.toFixed(3)} (expect high for hey_jarvis)`);
    setStatus(`WAV test done — highest score ${highest.toFixed(3)}`);
    meterFill.style.width = `${Math.min(100, highest * 100)}%`;
  } catch (err) {
    log(`WAV test failed: ${err?.message ?? err}`);
    setStatus("⚠️ WAV test failed — see log");
  } finally {
    testBtn.disabled = false;
  }
});
