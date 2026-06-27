/**
 * redesign-app.jsx — assembles one live-chat phone screen from a direction
 * config, plus the canvas of side-by-side directions.
 */
const { THEMES, STATES, RIcon, StateOrb, AmbientHalo, BreathingBar, MicControl, RunStop, TransportBar } = window;

function Bubble({ kind, text, time, dim }) {
  const isUser = kind === "user";
  const isThought = kind === "thought";
  const base = {
    maxWidth: "82%", padding: "0.5rem 0.75rem", fontSize: dim ? 13 : 14, lineHeight: 1.5,
    borderRadius: 16, whiteSpace: "pre-wrap", overflowWrap: "anywhere",
  };
  const style = isThought
    ? { ...base, alignSelf: "flex-end", background: "transparent", border: "1px dashed var(--line)", color: "var(--dim)", fontStyle: "italic", fontSize: 12.5, borderRadius: 12 }
    : isUser
    ? { ...base, alignSelf: "flex-start", background: "var(--bub-user)", color: "var(--fg)", borderEndStartRadius: 5 }
    : { ...base, alignSelf: "flex-end", background: "var(--bub-agent)", color: "var(--fg)", borderEndEndRadius: 5 };
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: isUser ? "flex-start" : "flex-end", gap: 2 }}>
      <div style={style}>{text}</div>
      {time && <span style={{ fontSize: 10.5, color: "var(--muted)", direction: "ltr" }}>{time}</span>}
    </div>
  );
}

function ToolRow({ text }) {
  return (
    <div style={{ alignSelf: "flex-end", maxWidth: "82%", display: "flex", alignItems: "center", gap: 8, padding: "0.45rem 0.7rem", borderRadius: 12, background: "var(--card)", border: "1px solid var(--border)", color: "var(--dim)", fontSize: 12.5 }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#34d399", flexShrink: 0 }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{text}</span>
      <RIcon name="chevron-down" size={13} style={{ marginInlineStart: "auto", color: "var(--muted)" }} />
    </div>
  );
}

function ChatFrame({ direction, state, playing }) {
  const t = THEMES[direction.theme];
  const s = STATES[state];
  const dim = direction.density === "min";
  const showOrb = direction.stateRep === "orb";
  const showBar = direction.stateRep === "bar";
  const showHalo = direction.stateRep === "halo";
  const btnAsState = direction.stateRep === "button" || direction.stateRep === "halo";
  const running = state === "thinking" || state === "tool";
  const topRunStop = direction.runStop === "top" && running;

  return (
    <div style={{ ...t.vars, position: "relative", height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)", color: "var(--fg)", fontFamily: '"Heebo", system-ui, sans-serif', direction: "rtl", overflow: "hidden" }}>
      {showHalo && <AmbientHalo state={state} />}
      {showBar && <BreathingBar state={state} />}

      {/* header */}
      <header style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8, padding: "0.6rem 0.8rem", borderBottom: "1px solid var(--border)" }}>
        <span style={{ width: 28, height: 28, borderRadius: "50%", background: "color-mix(in srgb, var(--neutral) 18%, transparent)", color: "var(--neutral)", display: "grid", placeItems: "center", flexShrink: 0 }}>
          <RIcon name="sparkles" size={15} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>claude</div>
          <div dir="ltr" style={{ fontSize: 10.5, color: "var(--muted)", fontFamily: "ui-monospace, monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "left" }}>~/projects/drive-coding</div>
        </div>
        {topRunStop ? <RunStop /> : (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: state === "idle" ? "var(--muted)" : s.color, fontWeight: 600 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: state === "idle" ? "var(--muted)" : s.color }} />{s.label}
          </span>
        )}
      </header>

      {/* chat list */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", gap: dim ? 8 : 12, padding: dim ? "0.7rem" : "0.9rem 0.8rem" }}>
        <Bubble kind="user" text="תקני את הבאג בהתחברות — אי אפשר להיכנס." time="14:22" />
        {!dim && <Bubble kind="thought" text="בודק את handler האימות…" />}
        <ToolRow text="קראתי את src/auth/login.ts" />
        <Bubble kind="agent" text="מצאתי: חסר await על verifySession. תיקנתי." time="14:23" />
      </div>

      {/* footer card */}
      <footer style={{ flexShrink: 0, display: "flex", justifyContent: "center", padding: "0 0.7rem 0.9rem" }}>
        <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: dim ? 8 : 11, padding: dim ? "0.7rem" : "0.85rem 0.8rem 1rem", borderStartStartRadius: 26, borderStartEndRadius: 26, background: "var(--elev)", border: "1px solid var(--border)", borderBottom: "none", boxShadow: "0 -10px 28px rgba(0,0,0,0.22)" }}>
          {direction.footer === "transport" ? (
            <TransportBar playing={playing} />
          ) : (
            <React.Fragment>
              {showOrb && <StateOrb state={state} size={dim ? 78 : 92} />}
              {!showOrb && (
                <div style={{ position: "relative", display: "grid", placeItems: "center" }}>
                  <MicControl state={state} asState={btnAsState} size={dim ? 80 : 92} />
                  {direction.runStop === "inline" && running && (
                    <div style={{ position: "absolute", insetInlineStart: "calc(100% + 8px)" }}><RunStop compact /></div>
                  )}
                </div>
              )}
              <span style={{ fontSize: 12.5, fontWeight: 600, color: state === "idle" ? "var(--dim)" : s.color }}>
                {state === "idle" ? "לחצי כדי לדבר" : s.label}
              </span>
            </React.Fragment>
          )}
        </div>
      </footer>
    </div>
  );
}

window.ChatFrame = ChatFrame;

// ─────────────────────────── canvas mount (runs last) ───────────────────────────
const ORDER = ["idle", "listening", "thinking", "tool", "speaking"];
const DIRECTIONS = [
  { id: "A", theme: "ink-dark",  stateRep: "button", runStop: "inline", footer: "mic",       density: "min",      title: "Ink · כפתור-כמצב",  sub: "מונוכרום, מינימלי. הכפתור עצמו הוא המחוון; עצירת-ריצה צמודה אליו.", init: "idle" },
  { id: "B", theme: "ink-dark",  stateRep: "halo",   runStop: "top",    footer: "mic",       density: "balanced", title: "Ink · הילת-קצה",     sub: "זוהר-מצב בשולי המסך לראייה היקפית. עצירת-ריצה בכותרת.",          init: "thinking" },
  { id: "C", theme: "ink-light", stateRep: "orb",    runStop: "top",    footer: "mic",       density: "balanced", title: "Daylight · אורב חי", sub: "וריאנט בהיר לנהיגת יום. אורב נושם מעל הקלט.",                   init: "listening" },
  { id: "D", theme: "slate-teal",stateRep: "bar",    runStop: "top",    footer: "transport", density: "balanced", title: "Slate/Teal · נגן",   sub: "פס-מצב עליון + נגן-מדיה מלא להקראה (קודם/הבא/השהיה/עצור).",     init: "speaking" },
];

function Legend() {
  return ORDER.map((k) => (
    <span className="li" key={k}>
      <span className="dot" style={{ background: STATES[k].color === "var(--neutral)" ? "#9a9aa0" : STATES[k].color }} />
      {STATES[k].label}
    </span>
  ));
}

function Frame({ d }) {
  const [state, setState] = React.useState(d.init);
  const [playing, setPlaying] = React.useState(true);
  return (
    <div className="frame">
      <div className="lbl"><b>{d.title}</b><span>{d.sub}</span></div>
      <div className="bezel"><div className="screen"><ChatFrame direction={d} state={state} playing={playing} /></div></div>
      <div className="ctrls">
        {ORDER.map((k) => (
          <button key={k} data-on={state === k ? "1" : "0"} onClick={() => setState(k)}>{STATES[k].label}</button>
        ))}
        {d.footer === "transport" && <button data-on={playing ? "1" : "0"} onClick={() => setPlaying((p) => !p)}>{playing ? "השהה" : "נגן"}</button>}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("legend")).render(<Legend />);
ReactDOM.createRoot(document.getElementById("row")).render(
  <React.Fragment>{DIRECTIONS.map((d) => <Frame key={d.id} d={d} />)}</React.Fragment>
);
