// orb-dom.js — CSS/DOM voice indicator. The orb is also the start/stop button.
//
// API (driven by app.js):
//   createDomOrb(container, { onClick })
//   orb.setLevel(rms)         // 0..~1 loudness → size + hue darkening
//   orb.setState('idle'|'listening'|'recording')  // base color (grey/blue/red)
//   orb.flash()               // wake word detected → white pulse
//   orb.reset()
//
// Smoothing strategy (matches the size handling that already felt good):
//   • loudness (size + brightness) updates every frame → smoothed in JS (lerp),
//     with a SHORT css transition (~80ms) just to bridge the frame steps.
//   • state color (grey↔blue↔red) changes only on events → LONG css transition
//     (~300ms) for a nice "transform" between modes.
//   These live on DIFFERENT css properties so their transitions never fight:
//     - background-color  → the base state color (long transition)
//     - filter: brightness → the loudness-driven darkening (short transition)

const STATE_COLORS = {
  idle: "#6b7280",       // grey
  listening: "#3b82f6",  // blue
  recording: "#ef4444",  // red
};

export function createDomOrb(container, { onClick } = {}) {
  container.classList.add("orb-dom-root");
  container.innerHTML = `
    <div class="orb-dom-core" role="button" tabindex="0" aria-label="toggle listening">
      <div class="orb-dom-flash"></div>
    </div>
  `;
  const core = container.querySelector(".orb-dom-core");
  const flashEl = container.querySelector(".orb-dom-flash");

  const BASE = 90;        // px diameter at silence
  const MAX_EXTRA = 130;  // px added at full loudness
  let smoothed = 0;       // smoothed, normalized RMS (0..1)

  function applyLoudness() {
    const size = BASE + smoothed * MAX_EXTRA;
    core.style.width = `${size}px`;
    core.style.height = `${size}px`;
    // Louder → DARKER. brightness 1.0 (silent) down to ~0.6 (loud).
    const brightness = 1 - smoothed * 0.4;
    core.style.filter = `brightness(${brightness})`;
  }

  function setLevel(rms) {
    const norm = Math.min(1, rms / 0.25);
    smoothed += (norm - smoothed) * 0.3; // JS lerp = the real smoothing
    applyLoudness();
  }

  function setState(state) {
    core.style.backgroundColor = STATE_COLORS[state] ?? STATE_COLORS.idle;
  }

  function flash() {
    flashEl.classList.remove("fire");
    void flashEl.offsetWidth; // reflow to restart the animation
    flashEl.classList.add("fire");
  }

  function reset() {
    smoothed = 0;
    applyLoudness();
    setState("idle");
    flashEl.classList.remove("fire");
  }

  if (onClick) {
    core.addEventListener("click", onClick);
    core.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); }
    });
  }

  reset();
  return { setLevel, setState, flash, reset };
}
