/**
 * App — the DriveCoding PWA shell: a connect → chat click-through inside a
 * phone frame, plus a live theme switcher demonstrating the 8 palettes.
 */
const PALETTES = ["ember", "forest", "plum", "teal", "midnight", "rose", "slate", "daylight"];

function App() {
  const [screen, setScreen] = React.useState("connect");
  const [connecting, setConnecting] = React.useState(false);
  const [agent, setAgent] = React.useState({ cli: "claude", cwd: "/home/user/projects/drive-coding" });
  const [palette, setPalette] = React.useState("ember");

  function connect({ cli, cwd }) {
    setAgent({ cli, cwd });
    setConnecting(true);
    setTimeout(() => { setConnecting(false); setScreen("chat"); }, 800);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1.25rem" }}>
      {/* theme switcher */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", justifyContent: "center" }}>
        <span style={{ fontSize: 12, color: "#8a8276", fontFamily: "var(--font)", marginInlineEnd: 4 }}>theme</span>
        {PALETTES.map((p) => (
          <button key={p} onClick={() => setPalette(p)} title={p} aria-label={p}
            style={{ width: 22, height: 22, borderRadius: "50%", cursor: "pointer", padding: 0, outline: palette === p ? "2px solid #fff" : "1px solid rgba(255,255,255,0.15)", outlineOffset: 2, border: "none", background: SWATCH[p] }} />
        ))}
      </div>

      {/* phone frame */}
      <div data-palette={palette}
        style={{ width: 392, height: 800, borderRadius: 40, padding: 12, background: "#000", boxShadow: "0 30px 80px rgba(0,0,0,0.5)", flexShrink: 0 }}>
        <div key={palette} style={{ width: "100%", height: "100%", borderRadius: 30, overflow: "hidden", background: "var(--bg)", position: "relative" }}>
          {screen === "connect"
            ? <window.ConnectScreen onConnect={connect} connecting={connecting} />
            : <window.ChatScreen cli={agent.cli} cwd={agent.cwd} onBack={() => setScreen("connect")} />}
        </div>
      </div>
    </div>
  );
}

const SWATCH = {
  ember: "#e8845c", forest: "#7fb685", plum: "#b794f6", teal: "#2dd4bf",
  midnight: "#6b8afd", rose: "#f472b6", slate: "#8aa0bd", daylight: "#d2693f",
};

window.App = App;
