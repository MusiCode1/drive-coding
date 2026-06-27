/**
 * redesign-modes-app.jsx — assembles the two-mode control deck + bottom sheet,
 * and mounts the comparison canvas. Loaded last (after shared + modes).
 */
const { THEMES, STATES, RIcon } = window;
const { TH, Round, Header, Chat, Transport, ModeToggle, MenuHandle, StatusInline } = window.RDM;

// big record button that reflects state (button-as-state)
function RecordMic({ state, size = 124 }) {
  const s = STATES[state];
  const live = state === "idle" ? "var(--neutral)" : s.color;
  return (
    <button aria-label={s.label} style={{
      width: size, height: size, borderRadius: "50%", border: "none", cursor: "pointer",
      background: live, color: "var(--bg)", display: "grid", placeItems: "center",
      boxShadow: state === "idle" ? "0 8px 24px rgba(0,0,0,.4)" : `0 0 0 7px color-mix(in srgb,${s.color} 22%,transparent)`,
      animation: state === "listening" ? "ringPulse 1.3s ease-out infinite" : undefined,
    }}>
      <RIcon name={s.icon} size={size * 0.36} sw={1.5} style={{ animation: s.spin ? "spin 1.1s linear infinite" : undefined }} />
    </button>
  );
}

function Deck({ mode, state }) {
  const running = state === "thinking" || state === "tool";
  const hasAudio = state === "speaking";

  if (mode === "record") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "1rem 0.9rem 1.1rem" }}>
        {/* primary: stop-run | MIC | replay — mic stays centered */}
        <div style={{ display: "grid", gridTemplateColumns: "66px 124px 66px", alignItems: "center", gap: 16 }}>
          <div style={{ display: "grid", placeItems: "center" }}>
            {running
              ? <Round icon="circle-stop" size={66} tone="danger" label="עצור ריצה" sw={2} />
              : <span style={{ width: 66 }} />}
          </div>
          <RecordMic state={state} />
          <div style={{ display: "grid", placeItems: "center" }}>
            <Round icon="volume-2" size={56} tone="ghost" label="השמע שוב" dimmed={!hasAudio} />
          </div>
        </div>
        {/* secondary: transport (smaller, subordinate) */}
        <Transport size={44} active={hasAudio} />
        {/* mode + menu */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", marginTop: 2 }}>
          <ModeToggle mode="record" /><MenuHandle />
        </div>
      </div>
    );
  }

  // prompt mode: chat owns the height; deck is slim
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 11, padding: "0.7rem 0.8rem 0.9rem" }}>
      {/* slim transport icons */}
      <Transport size={34} active={hasAudio} />
      {/* composer */}
      <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ width: "100%", minHeight: 46, padding: "0.6rem 0.7rem", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--muted)", fontSize: 14 }}>כתבי הודעה לסוכן…</div>
        </div>
        <button aria-label="שלח" style={{ width: 46, borderRadius: 12, border: "none", background: "var(--neutral)", color: "var(--bg)", cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0 }}>
          <RIcon name="send" size={18} sw={2} style={{ transform: "scaleX(-1)" }} />
        </button>
      </div>
      {/* mode + menu */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
        <ModeToggle mode="type" /><MenuHandle />
      </div>
    </div>
  );
}

function BottomSheet() {
  const rows = [
    { icon: "sparkles", t: "רשימת התהליכים", s: "3 סוכנים פעילים" },
    { icon: "volume-2", t: "קול הקראה", s: "Rachel · עברית" },
    { icon: "settings", t: "הגדרות", s: "שפה, מפתחות" },
    { icon: "mic", t: "בקרת רכב", s: "Media Session · כפתורי הגה" },
  ];
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 20, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} />
      <div style={{ position: "relative", background: "var(--elev)", borderStartStartRadius: 26, borderStartEndRadius: 26, borderTop: "1px solid var(--border)", boxShadow: "0 -16px 40px rgba(0,0,0,.5)", padding: "0.7rem 0.9rem 1.1rem", maxHeight: "64%" }}>
        <div style={{ width: 38, height: 4, borderRadius: 2, background: "var(--line)", margin: "2px auto 14px" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((r) => (
            <div key={r.t} style={{ display: "flex", alignItems: "center", gap: 12, padding: "0.7rem 0.8rem", borderRadius: 14, background: "var(--card)", border: "1px solid var(--border)" }}>
              <span style={{ width: 36, height: 36, borderRadius: 10, background: "color-mix(in srgb,var(--neutral) 16%,transparent)", color: "var(--neutral)", display: "grid", placeItems: "center", flexShrink: 0 }}><RIcon name={r.icon} size={18} /></span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--fg)" }}>{r.t}</div>
                <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{r.s}</div>
              </div>
              <RIcon name="chevron-down" size={16} style={{ transform: "rotate(90deg)", color: "var(--muted)" }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ModeFrame({ mode, state, sheet }) {
  const compact = mode === "record";
  return (
    <div style={{ ...TH, position: "relative", height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)", color: "var(--fg)", fontFamily: '"Heebo",system-ui,sans-serif', direction: "rtl", overflow: "hidden" }}>
      <Header state={state} />
      <Chat compact={compact} />
      <footer style={{ flexShrink: 0, background: "var(--elev)", borderStartStartRadius: 26, borderStartEndRadius: 26, borderTop: "1px solid var(--border)", boxShadow: "0 -10px 28px rgba(0,0,0,.22)" }}>
        <Deck mode={mode} state={state} />
      </footer>
      {sheet && <BottomSheet />}
    </div>
  );
}

window.ModeFrame = ModeFrame;

// ─────────── canvas mount ───────────
const FRAMES = [
  { title: "מצב הקלטה · רץ", sub: "מיק ענק + עצור-ריצה גדול לידו. צ'אט מצומצם. פלייליסט משני מתחת.", mode: "record", state: "tool", sheet: false },
  { title: "מצב הקלטה · מקריא", sub: "אותו דק; הפלייליסט פעיל (עצור-הקראה ≠ עצור-ריצה).", mode: "record", state: "speaking", sheet: false },
  { title: "מצב פרומפט", sub: "צ'אט מלא וקריא. מלחין טקסט + פלייליסט דק מעליו.", mode: "type", state: "idle", sheet: false },
  { title: "תפריט נגרר", sub: "Bottom-sheet: רשימת תהליכים, קול, הגדרות, בקרת רכב.", mode: "type", state: "idle", sheet: true },
];

function Card({ f }) {
  return (
    <div className="frame">
      <div className="lbl"><b>{f.title}</b><span>{f.sub}</span></div>
      <div className="bezel"><div className="screen"><ModeFrame mode={f.mode} state={f.state} sheet={f.sheet} /></div></div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("row")).render(
  <React.Fragment>{FRAMES.map((f, i) => <Card key={i} f={f} />)}</React.Fragment>
);
