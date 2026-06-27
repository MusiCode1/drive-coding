import React from "react";

/**
 * StatusPill — transient model-status indicator shown above the chat while
 * the agent works (waiting / thinking / responding / calling-tool / pending-
 * tts / speaking). Pulsing accent dot + label, agent-aligned.
 */
const LABELS = {
  waiting: "ממתין…",
  thinking: "חושב…",
  responding: "כותב תשובה…",
  "calling-tool": "מריץ כלי…",
  "pending-tts": "מכין הקראה…",
  speaking: "מקריא…",
};

export function StatusPill({ phase = "thinking", label, style }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.4rem",
        padding: "0.35rem 0.75rem",
        borderRadius: "var(--radius-xl)",
        fontSize: "var(--text-sm)",
        color: "var(--fg-dim)",
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        alignSelf: "flex-end",
        ...style,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "var(--radius-full)", background: "var(--accent)", animation: "pulse-dot 1.4s ease-in-out infinite", flexShrink: 0 }} />
      <span style={{ whiteSpace: "nowrap" }}>{label || LABELS[phase] || LABELS.thinking}</span>
    </div>
  );
}
