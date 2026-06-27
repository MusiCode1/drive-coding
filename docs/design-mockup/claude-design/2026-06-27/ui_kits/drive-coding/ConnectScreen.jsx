/**
 * ConnectScreen — the product's "/" view: pick a CLI + working directory,
 * choose a voice, and connect. Composes DS primitives (Select, TextInput,
 * IconButton, Button). Hebrew-first, RTL.
 */
const { Select, TextInput, IconButton, Button, Icon } = window.DriveCodingDesignSystem_a6504a;

function ConnectScreen({ onConnect, connecting }) {
  const [lang, setLang] = React.useState("he");
  const [cli, setCli] = React.useState("claude");
  const [cwd, setCwd] = React.useState("/home/user/projects/drive-coding");
  const [voice, setVoice] = React.useState("rachel");

  const Label = ({ children }) => (
    <span style={{ fontSize: "var(--text-sm)", color: "var(--fg-dim)" }}>{children}</span>
  );

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "2.5rem 1.25rem", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.7rem", marginBottom: "0.4rem" }}>
        <img src="../../assets/logo-icon-192.png" width="40" height="40" style={{ borderRadius: 11 }} alt="" />
        <h1 style={{ margin: 0, fontSize: "var(--text-2xl)", fontWeight: 800, color: "var(--fg)", letterSpacing: "-0.01em" }}>DriveCoding</h1>
      </div>
      <p style={{ margin: "0 0 1.75rem", color: "var(--fg-dim)", fontSize: "var(--text-md)" }}>בחרי CLI ותיקיית עבודה כדי להתחיל לדבר עם הסוכן.</p>

      <form style={{ display: "flex", flexDirection: "column", gap: "1rem" }} onSubmit={(e) => { e.preventDefault(); onConnect({ cli, cwd }); }}>
        <label style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <Label>שפה</Label>
          <Select value={lang} onChange={setLang} ariaLabel="שפה" options={[{ value: "he", label: "עברית" }, { value: "en", label: "English" }]} />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <Label>סוכן CLI</Label>
          <Select value={cli} onChange={setCli} ariaLabel="CLI" options={[{ value: "claude", label: "claude" }, { value: "opencode", label: "opencode" }, { value: "gemini", label: "gemini" }]} />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <Label>תיקיית עבודה</Label>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "stretch" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <TextInput value={cwd} onChange={setCwd} dir="ltr" placeholder="/home/user/project" />
            </div>
            <IconButton icon="folder" size="md" ariaLabel="בחר תיקייה" style={{ borderRadius: "var(--radius-lg)", width: 46 }} />
          </div>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <Label>קול הקראה</Label>
          <Select value={voice} onChange={setVoice} ariaLabel="קול" options={[{ value: "rachel", label: "Rachel — עברית" }, { value: "adam", label: "Adam — עברית" }, { value: "bella", label: "Bella — English" }]} />
        </label>

        <Button type="submit" fullWidth size="lg" disabled={connecting} style={{ marginTop: "0.5rem" }}>
          {connecting ? "מתחבר…" : "התחבר לסוכן"}
        </Button>
      </form>
    </div>
  );
}

window.ConnectScreen = ConnectScreen;
