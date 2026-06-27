import React from "react";
import { Icon } from "./Icon.jsx";

/**
 * Avatar — chat-row identity chip. Maps a bubble `kind` to a Lucide icon and
 * a soft tinted background, exactly as the product does:
 *   user → user / accent     agent → sparkles / accent
 *   thought → brain / thinking   tool → wrench / accent
 */
const CFG = {
  user: { icon: "user", bg: "color-mix(in srgb, var(--accent) 18%, transparent)", fg: "var(--accent-hi)" },
  agent: { icon: "sparkles", bg: "color-mix(in srgb, var(--accent) 22%, transparent)", fg: "var(--accent-hi)" },
  thought: { icon: "brain", bg: "color-mix(in srgb, var(--thinking) 15%, transparent)", fg: "var(--thinking)" },
  tool: { icon: "wrench", bg: "color-mix(in srgb, var(--accent) 15%, transparent)", fg: "var(--accent-hi)" },
};

export function Avatar({ kind = "agent", size = 28, style }) {
  const c = CFG[kind] || CFG.agent;
  return (
    <span
      style={{
        flexShrink: 0,
        width: size,
        height: size,
        display: "grid",
        placeItems: "center",
        borderRadius: "var(--radius-full)",
        background: c.bg,
        color: c.fg,
        ...style,
      }}
    >
      <Icon name={c.icon} size={Math.round(size * 0.54)} strokeWidth={1.75} />
    </span>
  );
}
