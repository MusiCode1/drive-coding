/**
 * redesign-frames.jsx — the live-chat screen + the agent-state representations
 * and the TTS media-transport, parameterized by `direction`.
 *
 * direction = { theme, stateRep, runStop, footer, density }
 *   theme    : "ink-dark" | "ink-light" | "slate-teal"
 *   stateRep : "button" | "orb" | "halo" | "bar"   (how agent state shows)
 *   runStop  : "top" | "inline"                      (where Stop-Run lives)
 *   footer   : "mic" | "transport"                   (footer content shown)
 *   density  : "min" | "balanced"
 */
const { THEMES, STATES, RIcon } = window;

// ─────────────────────────── agent-state representations ───────────────────────────

// 1) Living orb — one object that breathes; color+motion = state.
function StateOrb({ state, size = 96 }) {
  const s = STATES[state];
  return (
    <div style={{ position: "relative", width: size, height: size, display: "grid", placeItems: "center" }}>
      <div style={{
        position: "absolute", inset: 0, borderRadius: "50%",
        background: `radial-gradient(circle at 50% 40%, ${s.color} 0%, transparent 70%)`,
        opacity: 0.55, filter: "blur(6px)",
        animation: state === "idle" ? "orbBreath 4s ease-in-out infinite" : "orbBreath 1.6s ease-in-out infinite",
      }} />
      <div style={{
        width: size * 0.62, height: size * 0.62, borderRadius: "50%",
        border: `2px solid ${s.color}`, color: s.color, display: "grid", placeItems: "center",
        background: "color-mix(in srgb, var(--bg) 70%, transparent)",
        boxShadow: `0 0 24px ${s.color}`,
      }}>
        <RIcon name={s.icon} size={size * 0.26} style={{ animation: s.spin ? "spin 1.1s linear infinite" : undefined }} />
      </div>
    </div>
  );
}

// 2) Ambient edge halo — peripheral-vision cue, great for driving.
function AmbientHalo({ state }) {
  const s = STATES[state];
  if (state === "idle") return null;
  return <div style={{
    position: "absolute", inset: 0, pointerEvents: "none", borderRadius: "inherit",
    boxShadow: `inset 0 0 60px -10px ${s.color}, inset 0 0 18px -6px ${s.color}`,
    animation: "haloBreath 2.2s ease-in-out infinite", zIndex: 5,
  }} />;
}

// 3) Breathing top bar — thin status rail that fills/pulses.
function BreathingBar({ state }) {
  const s = STATES[state];
  return (
    <div style={{ height: 3, width: "100%", background: "var(--border)", overflow: "hidden", flexShrink: 0 }}>
      <div style={{
        height: "100%", background: s.color,
        width: state === "idle" ? "0%" : state === "tool" ? "70%" : "100%",
        opacity: state === "idle" ? 0 : 1,
        animation: state === "idle" ? "none" : "barPulse 1.6s ease-in-out infinite",
        transition: "width .4s ease, opacity .3s ease",
      }} />
    </div>
  );
}

// ─────────────────────────── controls ───────────────────────────

// Central mic — color+icon encode state when stateRep === "button".
function MicControl({ state, asState, onTap, size = 92 }) {
  const s = STATES[state];
  const live = asState ? s.color : "var(--neutral)";
  const isIdle = state === "idle";
  return (
    <button onClick={onTap} aria-label={s.label} style={{
      width: size, height: size, borderRadius: "50%", border: "none", cursor: "pointer",
      display: "grid", placeItems: "center",
      background: asState ? live : "var(--neutral)",
      color: THEMES_ON(state, asState),
      boxShadow: asState && !isIdle ? `0 0 0 6px color-mix(in srgb, ${s.color} 22%, transparent)` : "0 6px 18px rgba(0,0,0,.25)",
      animation: asState && s.ring ? "ringPulse 1.3s ease-out infinite" : undefined,
      transition: "background .3s ease, box-shadow .3s ease",
    }}>
      <RIcon name={asState ? s.icon : "mic"} size={size * 0.34} sw={1.6}
        style={{ animation: asState && s.spin ? "spin 1.1s linear infinite" : undefined }} />
    </button>
  );
}
function THEMES_ON(state, asState) {
  // dark glyph on bright state fills; otherwise theme onState
  return "var(--bg)";
}

// Stop-RUN — heavy, cancels the agent. Warning-toned, distinct from TTS stop.
function RunStop({ compact }) {
  return (
    <button aria-label="עצור ריצה" style={{
      display: "inline-flex", alignItems: "center", gap: compact ? 0 : 6,
      padding: compact ? 0 : "0.4rem 0.7rem", height: compact ? 36 : "auto",
      width: compact ? 36 : "auto", justifyContent: "center",
      borderRadius: compact ? "50%" : "var(--radius-full, 999px)",
      border: "1px solid #ff5a5a", background: "color-mix(in srgb,#ff5a5a 14%, transparent)",
      color: "#ff6b6b", fontFamily: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer",
    }}>
      <RIcon name="circle-stop" size={16} sw={2} />{!compact && "עצור ריצה"}
    </button>
  );
}

// TTS media transport — the "playlist" of answer segments.
function TransportBar({ playing, seg = 2, total = 5 }) {
  const Btn = ({ icon, big, label }) => (
    <button aria-label={label} style={{
      width: big ? 56 : 42, height: big ? 56 : 42, borderRadius: "50%", border: "none", cursor: "pointer",
      display: "grid", placeItems: "center",
      background: big ? "#34d399" : "var(--card)", color: big ? "var(--bg)" : "var(--fg)",
      boxShadow: big ? "0 0 18px color-mix(in srgb,#34d399 50%, transparent)" : "none",
    }}><RIcon name={icon} size={big ? 24 : 19} /></button>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#34d399", fontSize: 12, fontWeight: 600 }}>
        <RIcon name="volume-2" size={14} /> מקריא · סגמנט {seg}/{total}
      </div>
      {/* segment progress */}
      <div style={{ display: "flex", gap: 4, width: "82%" }}>
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i < seg ? "#34d399" : "var(--border)" }} />
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <Btn icon="circle-stop" label="עצור הקראה" />
        <Btn icon="skip-back" label="סגמנט קודם" />
        <Btn icon={playing ? "pause" : "play"} big label={playing ? "השהה" : "נגן"} />
        <Btn icon="skip-forward" label="סגמנט הבא" />
        <button aria-label="הקלדה" style={{ width: 42, height: 42, borderRadius: "50%", border: "1px solid var(--border)", background: "transparent", color: "var(--dim)", cursor: "pointer", display: "grid", placeItems: "center" }}>
          <RIcon name="keyboard" size={19} />
        </button>
      </div>
    </div>
  );
}

window.StateOrb = StateOrb;
window.AmbientHalo = AmbientHalo;
window.BreathingBar = BreathingBar;
window.MicControl = MicControl;
window.RunStop = RunStop;
window.TransportBar = TransportBar;
