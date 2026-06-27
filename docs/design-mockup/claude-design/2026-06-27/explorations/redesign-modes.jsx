/**
 * redesign-modes.jsx — record-mode vs prompt-mode space division, the adaptive
 * control deck, unified status, back-to-processes button, and the drag-up
 * bottom sheet. Reuses redesign-shared.jsx (RIcon, THEMES, STATES).
 * Working palette: ink-dark (palette is a separate decision).
 */
const { THEMES, STATES, RIcon } = window;
const TH = THEMES["ink-dark"].vars;

// round control button
function Round({ icon, size = 48, tone = "soft", label, sw = 1.75, dimmed }) {
  const styles = {
    hero:   { background: "var(--neutral)", color: "var(--bg)", shadow: "0 8px 22px rgba(0,0,0,.35)" },
    danger: { background: "color-mix(in srgb,#ff5a5a 16%,transparent)", color: "#ff6b6b", border: "1px solid #ff5a5a" },
    soft:   { background: "var(--card)", color: "var(--fg)", border: "1px solid var(--border)" },
    ghost:  { background: "transparent", color: "var(--dim)", border: "1px solid var(--border)" },
    play:   { background: "#34d399", color: "var(--bg)", shadow: "0 0 16px color-mix(in srgb,#34d399 45%,transparent)" },
  }[tone];
  return (
    <button aria-label={label} style={{
      width: size, height: size, borderRadius: "50%", border: styles.border || "none",
      background: styles.background, color: styles.color, boxShadow: styles.shadow || "none",
      cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0,
      opacity: dimmed ? 0.4 : 1,
    }}><RIcon name={icon} size={size * 0.4} sw={sw} /></button>
  );
}

// unified status: dot + label, in the header (merges status light + status line)
function StatusInline({ state }) {
  const s = STATES[state];
  const c = state === "idle" ? "var(--muted)" : s.color;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: c }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: c, animation: state === "idle" ? "none" : "barPulse 1.4s ease-in-out infinite" }} />
      {s.label}
    </span>
  );
}

function Header({ state }) {
  return (
    <header style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10, padding: "0.6rem 0.7rem", borderBottom: "1px solid var(--border)" }}>
      <button aria-label="חזרה לרשימת התהליכים" style={{ width: 36, height: 36, borderRadius: "50%", border: "1px solid var(--border)", background: "transparent", color: "var(--fg)", cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0 }}>
        <RIcon name="chevron-down" size={18} style={{ transform: "rotate(90deg)" }} />
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>claude</div>
        <div dir="ltr" style={{ fontSize: 10, color: "var(--muted)", fontFamily: "ui-monospace,monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "left" }}>~/projects/drive-coding</div>
      </div>
      <StatusInline state={state} />
    </header>
  );
}

function Chat({ compact }) {
  const fs = compact ? 11.5 : 14;
  const Bub = ({ who, text, t }) => {
    const user = who === "user";
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: user ? "flex-start" : "flex-end", gap: 2 }}>
        <div style={{ maxWidth: "82%", padding: compact ? "0.35rem 0.55rem" : "0.5rem 0.75rem", fontSize: fs, lineHeight: 1.45, borderRadius: 14, background: user ? "var(--bub-user)" : "var(--bub-agent)", color: "var(--fg)", [user ? "borderEndStartRadius" : "borderEndEndRadius"]: 5 }}>{text}</div>
        {t && !compact && <span style={{ fontSize: 10, color: "var(--muted)", direction: "ltr" }}>{t}</span>}
      </div>
    );
  };
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: compact ? "flex-end" : "flex-start", gap: compact ? 6 : 11, padding: compact ? "0.5rem 0.7rem" : "0.8rem 0.7rem" }}>
      {!compact && <Bub who="user" text="תקני את הבאג בהתחברות — אי אפשר להיכנס." t="14:22" />}
      {!compact && <Bub who="agent" text="בודק את handler האימות…" />}
      <Bub who="user" text="תקני את שגיאת הטיפוסים ב-build." t="14:24" />
      <Bub who="agent" text="תיקנתי את הטיפוס ב-options.ts וה-build עובר." t="14:24" />
    </div>
  );
}

// transport strip — sizes by mode. stop-TTS lives HERE (neutral, segment player).
function Transport({ size = 44, active, seg = 2, total = 5 }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", alignItems: "center", opacity: active ? 1 : 0.55 }}>
      {size >= 44 && (
        <div style={{ display: "flex", gap: 4, width: "78%" }}>
          {Array.from({ length: total }).map((_, i) => <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i < seg ? "#34d399" : "var(--border)" }} />)}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: size >= 44 ? 12 : 8 }}>
        <Round icon="circle-stop" size={size} tone="soft" label="עצור הקראה" dimmed={!active} />
        <Round icon="skip-back" size={size} tone="soft" label="סגמנט קודם" dimmed={!active} />
        <Round icon={active ? "pause" : "play"} size={size + 6} tone="play" label={active ? "השהה" : "נגן"} />
        <Round icon="skip-forward" size={size} tone="soft" label="סגמנט הבא" dimmed={!active} />
      </div>
    </div>
  );
}

function ModeToggle({ mode }) {
  const tabs = [{ id: "record", icon: "mic", label: "הקלטה" }, { id: "type", icon: "keyboard", label: "הקלדה" }];
  return (
    <div style={{ display: "inline-flex", gap: 3, padding: 3, borderRadius: 999, background: "var(--card)" }}>
      {tabs.map((t) => (
        <span key={t.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "0.35rem 0.7rem", borderRadius: 999, fontSize: 12, fontWeight: 600, background: mode === t.id ? "var(--neutral)" : "transparent", color: mode === t.id ? "var(--bg)" : "var(--dim)" }}>
          <RIcon name={t.icon} size={13} sw={2} />{t.label}
        </span>
      ))}
    </div>
  );
}

function MenuHandle() {
  return (
    <button aria-label="פתח תפריט" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0.35rem 0.8rem", borderRadius: 999, border: "1px solid var(--border)", background: "transparent", color: "var(--dim)", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
      <RIcon name="chevron-down" size={14} style={{ transform: "rotate(180deg)" }} /> תפריט
    </button>
  );
}

window.RDM = { TH, Round, Header, Chat, Transport, ModeToggle, MenuHandle, StatusInline };
