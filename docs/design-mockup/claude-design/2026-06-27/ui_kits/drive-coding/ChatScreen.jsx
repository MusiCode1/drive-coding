/**
 * ChatScreen — the product's live agent view (/chat). Fixed header + scrolling
 * bubble list + a footer "record / type / hide" mode toggle over either the
 * 110px MicButton or a text composer. Composes DS chat primitives.
 */
const {
  ChatBubble, ToolCall, StatusPill, MicButton, Avatar,
  Badge, IconButton, Button, TextInput, Icon,
} = window.DriveCodingDesignSystem_a6504a;

function Header({ cli, cwd, onBack }) {
  return (
    <header style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.7rem 0.9rem", borderBottom: "1px solid var(--border)", background: "var(--bg)" }}>
      <IconButton icon="chevron-down" size="sm" variant="ghost" ariaLabel="חזור" onClick={onBack} style={{ transform: "rotate(90deg)" }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: "var(--text-md)", fontWeight: 700, color: "var(--fg)" }}>{cli}</div>
        <div dir="ltr" style={{ fontSize: "var(--text-xs)", color: "var(--fg-muted)", fontFamily: "var(--font-mono)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "left" }}>{cwd}</div>
      </div>
      <Badge tone="connected" dot>מחובר</Badge>
      <IconButton icon="settings" size="sm" variant="ghost" ariaLabel="הגדרות" />
    </header>
  );
}

function ModeToggle({ mode, setMode }) {
  const tabs = [{ id: "record", icon: "mic", label: "הקלטה" }, { id: "type", icon: "keyboard", label: "הקלדה" }, { id: "hide", icon: "eye-off", label: "הסתר" }];
  return (
    <div style={{ display: "inline-flex", gap: "0.25rem", padding: "0.25rem", borderRadius: "var(--radius-full)", background: "var(--bg-card)" }}>
      {tabs.map((t) => (
        <button key={t.id} onClick={() => setMode(t.id)} aria-pressed={mode === t.id}
          style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.4rem 0.85rem", borderRadius: "var(--radius-full)", border: "none", cursor: "pointer", fontSize: "var(--text-xs)", fontWeight: 600, fontFamily: "var(--font)", background: mode === t.id ? "var(--accent)" : "transparent", color: mode === t.id ? "#fff" : "var(--fg-dim)", transition: "all var(--dur-fast) var(--ease)" }}>
          <Icon name={t.icon} size={13} strokeWidth={2} />{t.label}
        </button>
      ))}
    </div>
  );
}

function ChatScreen({ cli, cwd, onBack }) {
  const [bubbles, setBubbles] = React.useState(() => seed());
  const [phase, setPhase] = React.useState(null); // StatusPill phase or null
  const [mode, setMode] = React.useState("record");
  const [micState, setMicState] = React.useState("idle");
  const [draft, setDraft] = React.useState("");
  const listRef = React.useRef(null);

  React.useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [bubbles, phase]);

  function agentReply(userText) {
    setPhase("thinking");
    setTimeout(() => setPhase("calling-tool"), 700);
    setTimeout(() => {
      setBubbles((b) => [...b, { kind: "tool", status: "completed", narration: "הרצתי את הבדיקות", command: "pnpm test", result: "✓ 41 passed (2.3s)" }]);
      setPhase("responding");
    }, 1500);
    setTimeout(() => {
      setBubbles((b) => [...b, { kind: "agent", text: replyFor(userText), time: now() }]);
      setPhase(null);
    }, 2400);
  }

  function sendText() {
    const text = draft.trim();
    if (!text) return;
    setBubbles((b) => [...b, { kind: "user", text, time: now() }]);
    setDraft("");
    agentReply(text);
  }

  function tapMic() {
    if (micState === "idle") { setMicState("recording"); return; }
    if (micState === "recording") {
      setMicState("transcribing");
      setTimeout(() => {
        setBubbles((b) => [...b, { kind: "user", text: "תקני את שגיאת הטיפוסים ב-build", time: now() }]);
        setMicState("thinking");
      }, 900);
      setTimeout(() => setMicState("speaking"), 2400);
      setTimeout(() => {
        setBubbles((b) => [...b, { kind: "agent", text: "תיקנתי את הטיפוס ב-options.ts וה-build עובר עכשיו.", time: now() }]);
        setMicState("idle");
      }, 4200);
      return;
    }
    if (micState === "speaking" || micState === "thinking") setMicState("idle");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Header cli={cli} cwd={cwd} onBack={onBack} />

      <div ref={listRef} style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "var(--space-3)", padding: "1rem 0.9rem", minHeight: 0 }}>
        {bubbles.map((b, i) =>
          b.kind === "tool" ? (
            <ToolCall key={i} status={b.status} narration={b.narration} command={b.command} result={b.result} />
          ) : (
            <ChatBubble key={i} kind={b.kind} text={b.text} time={b.time}
              actions={b.kind === "agent" ? [{ icon: "copy", label: "העתק" }, { icon: "play", label: "השמע" }] : undefined} />
          )
        )}
        {phase && <StatusPill phase={phase} />}
      </div>

      <footer style={{ flexShrink: 0, display: "flex", justifyContent: "center", padding: "0 0.9rem 1rem" }}>
        <div style={{ width: "100%", maxWidth: 520, display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem", padding: "0.9rem 0.9rem 1.1rem", borderStartStartRadius: "var(--radius-card)", borderStartEndRadius: "var(--radius-card)", background: "var(--bg-elev)", border: "1px solid var(--border)", borderBottom: "none", boxShadow: "var(--shadow-card)" }}>
          <ModeToggle mode={mode} setMode={setMode} />
          {mode === "record" && <MicButton state={micState} onClick={tapMic} onStop={() => setMicState("idle")} />}
          {mode === "type" && (
            <form onSubmit={(e) => { e.preventDefault(); sendText(); }} style={{ display: "flex", gap: "0.5rem", width: "100%", alignItems: "stretch" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <TextInput multiline rows={2} surface="card" value={draft} onChange={setDraft} placeholder="כתבי הודעה לסוכן…"
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendText(); } }} />
              </div>
              <Button type="submit" disabled={!draft.trim()} ariaLabel="שלח" style={{ alignSelf: "stretch" }}><Icon name="send" size={16} strokeWidth={2} style={{ transform: "scaleX(-1)" }} /></Button>
            </form>
          )}
          {mode === "hide" && <div style={{ height: 8 }} />}
        </div>
      </footer>
    </div>
  );
}

function now() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function replyFor(t) {
  return "הבנתי. אני מטפל בזה ומעדכן אותך ברגע שזה מוכן.";
}
function seed() {
  return [
    { kind: "user", text: "תקני את הבאג בהתחברות — המשתמשים לא מצליחים להיכנס.", time: "14:22" },
    { kind: "thought", text: "בודק את handler האימות ומחפש איפה ה-session נכשל…" },
    { kind: "tool", status: "completed", narration: "קראתי את src/auth/login.ts", command: "cat src/auth/login.ts", result: "export function login(creds) {\n  // missing await on verifySession\n}" },
    { kind: "agent", text: "מצאתי את הבעיה: חסר `await` על `verifySession`. תיקנתי והוספתי בדיקה שתתפוס את זה בעתיד.", time: "14:23" },
  ];
}

window.ChatScreen = ChatScreen;
