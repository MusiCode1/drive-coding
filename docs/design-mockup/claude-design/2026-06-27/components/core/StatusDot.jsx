import React from "react";

/**
 * StatusDot — a tool-call status indicator. Colors are fixed semantics
 * (not theme-tinted) so completed/failed read identically across palettes,
 * matching the product's ToolBubble dots. in_progress pulses.
 */
const COLORS = {
  pending: "var(--fg-muted)",
  in_progress: "#f97316",
  completed: "#22c55e",
  failed: "#ef4444",
};

export function StatusDot({ status = "pending", size = 8, style }) {
  const isPulsing = status === "in_progress";
  return (
    <span
      role="status"
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "var(--radius-full)",
        background: COLORS[status] || COLORS.pending,
        flexShrink: 0,
        animation: isPulsing ? "pulse-dot 1s ease-in-out infinite" : undefined,
        ...style,
      }}
    />
  );
}
