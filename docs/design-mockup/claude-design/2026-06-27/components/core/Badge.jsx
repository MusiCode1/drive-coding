import React from "react";

/**
 * Badge — small status/label pill. Used for agent status in the header
 * (connected / connecting / disconnected) and generic labels.
 */
const TONES = {
  neutral: { bg: "var(--bg-card)", fg: "var(--fg-dim)", dot: "var(--fg-muted)" },
  accent: { bg: "var(--accent-soft)", fg: "var(--accent-hi)", dot: "var(--accent)" },
  connected: { bg: "color-mix(in srgb, var(--speaking) 16%, transparent)", fg: "var(--speaking)", dot: "var(--speaking)" },
  connecting: { bg: "color-mix(in srgb, var(--thinking) 16%, transparent)", fg: "var(--thinking)", dot: "var(--thinking)" },
  error: { bg: "color-mix(in srgb, var(--recording) 14%, transparent)", fg: "var(--recording)", dot: "var(--recording)" },
};

export function Badge({ children, tone = "neutral", dot = false, style }) {
  const t = TONES[tone] || TONES.neutral;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.4rem",
        padding: dot ? "0.25rem 0.6rem 0.25rem 0.5rem" : "0.25rem 0.6rem",
        borderRadius: "var(--radius-full)",
        background: t.bg,
        color: t.fg,
        fontSize: "var(--text-xs)",
        fontWeight: "var(--fw-semibold)",
        lineHeight: 1.4,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {dot && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "var(--radius-full)",
            background: t.dot,
            flexShrink: 0,
          }}
        />
      )}
      {children}
    </span>
  );
}
