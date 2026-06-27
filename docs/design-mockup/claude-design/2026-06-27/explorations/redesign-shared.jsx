/**
 * redesign-shared.jsx — foundations for the DriveCoding redesign exploration.
 * Self-contained (no DS bundle dependency) so each direction can be themed
 * independently and read as a fresh proposal, not the current build.
 *
 * Exposes on window: THEMES, STATES, RIcon, applyTheme.
 */

// ── Themes: applied as inline CSS custom properties on each phone frame ──
const THEMES = {
  "ink-dark": {
    label: "Ink",
    vars: {
      "--bg": "#0b0b0c", "--elev": "#161618", "--card": "#202024",
      "--fg": "#f5f5f4", "--dim": "#a1a1a6", "--muted": "#6b6b70",
      "--border": "rgba(255,255,255,0.09)", "--line": "rgba(255,255,255,0.18)",
      "--neutral": "#f5f5f4", "--bub-user": "#202024", "--bub-agent": "#19191b",
    },
    onState: "#0b0b0c",
  },
  "ink-light": {
    label: "Daylight",
    vars: {
      "--bg": "#f3f3f1", "--elev": "#fbfbfa", "--card": "#ffffff",
      "--fg": "#17171a", "--dim": "#5c5c63", "--muted": "#8e8e96",
      "--border": "rgba(0,0,0,0.10)", "--line": "rgba(0,0,0,0.20)",
      "--neutral": "#17171a", "--bub-user": "#eceae6", "--bub-agent": "#f4f3f0",
    },
    onState: "#ffffff",
  },
  "slate-teal": {
    label: "Slate / Teal",
    vars: {
      "--bg": "#0e1416", "--elev": "#16201f", "--card": "#1c2a29",
      "--fg": "#e3edeb", "--dim": "#97aeac", "--muted": "#647d7a",
      "--border": "rgba(220,255,250,0.08)", "--line": "rgba(220,255,250,0.18)",
      "--neutral": "#2dd4bf", "--bub-user": "#173330", "--bub-agent": "#142220",
    },
    onState: "#06100f",
  },
};

// ── State language: ONE color + icon + label per agent state. ──
// Vivid even in monochrome themes — color is reserved to MEAN state.
const STATES = {
  idle:      { color: "var(--neutral)", icon: "mic",     label: "מוכן",        ring: false },
  listening: { color: "#ff5a5a",        icon: "mic",     label: "מקשיב…",      ring: true  },
  thinking:  { color: "#a78bfa",        icon: "brain",   label: "חושב…",       spin: true  },
  tool:      { color: "#f6a23c",        icon: "wrench",  label: "מריץ כלי…",   spin: true  },
  speaking:  { color: "#34d399",        icon: "volume-2",label: "מקריא תשובה", wave: true  },
};

// ── Minimal Lucide subset (outline, 1.75) for the exploration. ──
const RPATHS = {
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
  "volume-2": '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
  brain: '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  square: '<rect width="14" height="14" x="5" y="5" rx="2"/>',
  "circle-stop": '<circle cx="12" cy="12" r="10"/><rect width="6" height="6" x="9" y="9" rx="1"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  "skip-back": '<polygon points="19 20 9 12 19 4 19 20"/><line x1="5" x2="5" y1="19" y2="5"/>',
  "skip-forward": '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" x2="19" y1="5" y2="19"/>',
  keyboard: '<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',
  "eye-off": '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
};

function RIcon({ name, size = 18, sw = 1.75, style }) {
  const inner = RPATHS[name];
  if (!inner) return null;
  return React.createElement("svg", {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: sw, strokeLinecap: "round",
    strokeLinejoin: "round",
    style: { display: "block", flexShrink: 0, ...style },
    "aria-hidden": true,
    dangerouslySetInnerHTML: { __html: inner },
  });
}

window.THEMES = THEMES;
window.STATES = STATES;
window.RIcon = RIcon;
