// orb-dom.js — CSS/DOM voice indicator.
//
// Same API as orb-canvas.js so index.html can drive both identically:
//   const orb = createDomOrb(containerEl)
//   orb.setLevel(rms)        // 0..~1 loudness → size
//   orb.setVad(bool)         // speaking? → color
//   orb.setCapturing(bool)   // recording between wake words? → red ring
//   orb.flash()              // wake word detected → glow pulse
//   orb.reset()
//
// Build it with markup so transitions handle the smoothing.

export function createDomOrb(container) {
  container.classList.add("orb-dom-root");
  container.innerHTML = `
    <div class="orb-dom-ring"></div>
    <div class="orb-dom-core"></div>
    <div class="orb-dom-flash"></div>
  `;
  const core = container.querySelector(".orb-dom-core");
  const ring = container.querySelector(".orb-dom-ring");
  const flashEl = container.querySelector(".orb-dom-flash");

  const BASE = 90;      // px diameter at silence
  const MAX_EXTRA = 130; // px added at full loudness
  let smoothed = 0;     // smoothed RMS

  function setLevel(rms) {
    // RMS is small (~0..0.3); normalize & clamp, then ease toward it.
    const norm = Math.min(1, rms / 0.25);
    smoothed += (norm - smoothed) * 0.3; // lerp for organic feel
    const size = BASE + smoothed * MAX_EXTRA;
    core.style.width = `${size}px`;
    core.style.height = `${size}px`;
  }

  function setVad(active) {
    core.classList.toggle("speaking", active);
  }

  function setCapturing(active) {
    ring.classList.toggle("active", active);
  }

  function flash() {
    flashEl.classList.remove("fire");
    // reflow to restart the animation
    void flashEl.offsetWidth;
    flashEl.classList.add("fire");
  }

  function reset() {
    smoothed = 0;
    core.style.width = `${BASE}px`;
    core.style.height = `${BASE}px`;
    core.classList.remove("speaking");
    ring.classList.remove("active");
    flashEl.classList.remove("fire");
  }

  reset();
  return { setLevel, setVad, setCapturing, flash, reset };
}
