import React from "react";
import { Avatar } from "../core/Avatar.jsx";
import { StatusDot } from "../core/StatusDot.jsx";
import { Icon } from "../core/Icon.jsx";

/**
 * ToolCall — a collapsible tool-invocation card on the agent side.
 *
 * Header: status dot + narration (human summary) or mono title + chevron.
 * Expanded: command/args ($-prefixed mono) and result. Mirrors the product's
 * ToolBubble (native disclosure, self-end, accent-free surface).
 */
export function ToolCall({ status = "completed", narration, title, command, result, defaultOpen = false, style }) {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end", maxWidth: "78%", alignSelf: "flex-end", flexDirection: "row-reverse", ...style }}>
      <Avatar kind="tool" />
      <div style={{ flex: 1, minWidth: 0, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden", fontSize: "var(--text-sm)" }}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            width: "100%",
            padding: "0.5rem 0.75rem",
            background: "transparent",
            border: "none",
            color: "var(--fg-dim)",
            cursor: "pointer",
            textAlign: "start",
          }}
        >
          <StatusDot status={status} />
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {narration ? (
              <span dir="auto">{narration}</span>
            ) : title ? (
              <span dir="ltr" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>{title}</span>
            ) : (
              <span style={{ opacity: 0.4, fontStyle: "italic" }}>מריץ כלי…</span>
            )}
          </span>
          <span style={{ transition: "transform var(--dur-base) var(--ease)", transform: open ? "rotate(180deg)" : "none", color: "var(--fg-muted)" }}>
            <Icon name="chevron-down" size={14} />
          </span>
        </button>

        {open && (command || result) && (
          <div style={{ borderTop: "1px solid var(--border)", padding: "0.5rem 0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem" }} dir="ltr">
            {command && (
              <div>
                <div style={{ fontSize: "var(--text-xs)", fontWeight: "var(--fw-semibold)", opacity: 0.6, textTransform: "uppercase", letterSpacing: "var(--tracking-label)", marginBottom: 2 }}>ARGS</div>
                <pre style={preStyle}><span style={{ color: "#4ade80" }}>$ </span>{command}</pre>
              </div>
            )}
            {result && (
              <div>
                <div style={{ fontSize: "var(--text-xs)", fontWeight: "var(--fw-semibold)", opacity: 0.6, textTransform: "uppercase", letterSpacing: "var(--tracking-label)", marginBottom: 2 }}>RESULT</div>
                <pre style={preStyle}>{result}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const preStyle = {
  fontFamily: "var(--font-mono)",
  fontSize: "var(--text-sm)",
  whiteSpace: "pre-wrap",
  wordWrap: "break-word",
  margin: 0,
  background: "var(--bg)",
  padding: "0.4rem 0.5rem",
  borderRadius: "var(--radius-sm)",
  color: "var(--fg)",
  maxHeight: 220,
  overflowY: "auto",
  direction: "ltr",
  textAlign: "left",
};
