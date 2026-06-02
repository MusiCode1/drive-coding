// orb-canvas.js — Canvas voice indicator (same API as orb-dom.js).
//
//   const orb = createCanvasOrb(canvasEl)
//   orb.setLevel(rms) / setVad(bool) / setCapturing(bool) / flash() / reset()
//
// Canvas lets us add things DOM can't do as cleanly: expanding sound rings,
// a soft pulsing glow, and an animated capture ring. Runs its own rAF loop.

export function createCanvasOrb(canvas) {
  const ctx = canvas.getContext("2d");
  const DPR = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 300;
  const H = canvas.clientHeight || 300;
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  ctx.scale(DPR, DPR);
  const cx = W / 2;
  const cy = H / 2;

  const BASE_R = 45;
  const MAX_EXTRA = 70;

  let smoothed = 0;
  let speaking = false;
  let capturing = false;
  let flashT = 0;            // 0..1 decaying flash intensity
  let ripples = [];          // expanding rings spawned while speaking
  let rippleCooldown = 0;
  let raf = null;

  function setLevel(rms) {
    const norm = Math.min(1, rms / 0.25);
    smoothed += (norm - smoothed) * 0.3;
    // spawn a ripple when speaking and loud enough
    if (speaking && smoothed > 0.15 && rippleCooldown <= 0) {
      ripples.push({ r: BASE_R + smoothed * MAX_EXTRA, a: 0.5 });
      rippleCooldown = 6;
    }
    if (rippleCooldown > 0) rippleCooldown--;
  }
  function setVad(active) { speaking = active; }
  function setCapturing(active) { capturing = active; }
  function flash() { flashT = 1; }
  function reset() { smoothed = 0; speaking = false; capturing = false; flashT = 0; ripples = []; }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const r = BASE_R + smoothed * MAX_EXTRA;

    // expanding ripples (sound waves)
    for (const rp of ripples) {
      ctx.beginPath();
      ctx.arc(cx, cy, rp.r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(96,165,250,${rp.a})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      rp.r += 2.5;
      rp.a -= 0.012;
    }
    ripples = ripples.filter((rp) => rp.a > 0);

    // soft glow
    const glow = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 1.8);
    const baseColor = speaking ? [74, 222, 128] : [96, 165, 250]; // green : blue
    glow.addColorStop(0, `rgba(${baseColor.join(",")},0.35)`);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // core orb
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    const core = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
    core.addColorStop(0, `rgba(${baseColor.map((c) => Math.min(255, c + 60)).join(",")},1)`);
    core.addColorStop(1, `rgba(${baseColor.join(",")},0.9)`);
    ctx.fillStyle = core;
    ctx.fill();

    // capture ring (red, animated dash)
    if (capturing) {
      ctx.beginPath();
      ctx.arc(cx, cy, r + 14, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(248,113,113,0.95)";
      ctx.lineWidth = 4;
      ctx.setLineDash([8, 6]);
      ctx.lineDashOffset = -(Date.now() / 30) % 14;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // detect flash — white expanding pulse
    if (flashT > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, r + (1 - flashT) * 80, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,255,${flashT})`;
      ctx.lineWidth = 6 * flashT + 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${flashT * 0.4})`;
      ctx.fill();
      flashT -= 0.04;
    }

    raf = requestAnimationFrame(draw);
  }

  function start() { if (!raf) draw(); }
  function destroy() { if (raf) cancelAnimationFrame(raf); raf = null; }

  start();
  return { setLevel, setVad, setCapturing, flash, reset, destroy };
}
