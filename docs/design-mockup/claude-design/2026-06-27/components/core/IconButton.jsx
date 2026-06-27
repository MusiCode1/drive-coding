import React from "react";
import { Icon } from "./Icon.jsx";

/**
 * IconButton — round icon-only control. Used for the side controls next to
 * the mic (stop, replay), bubble actions (copy/play), and toolbar buttons.
 */
export function IconButton({
  icon,
  size = "md",
  variant = "soft",
  ariaLabel,
  disabled = false,
  onClick,
  style,
  ...rest
}) {
  const sizes = {
    xs: { box: 22, icon: 12 }, // bubble action chip
    sm: { box: 32, icon: 16 },
    md: { box: 44, icon: 20 }, // min touch target
    lg: { box: 56, icon: 24 }, // drive-first side control
  };
  const s = sizes[size] || sizes.md;

  const variants = {
    soft: { background: "var(--bg-card)", color: "var(--fg-dim)", border: "1px solid var(--border)" },
    solid: { background: "var(--accent)", color: "#fff", border: "1px solid transparent" },
    ghost: { background: "transparent", color: "var(--fg-dim)", border: "1px solid transparent" },
    muted: { background: "var(--fg-muted)", color: "var(--bg)", border: "1px solid transparent" },
  };
  const v = variants[variant] || variants.soft;

  const [hover, setHover] = React.useState(false);
  const hoverStyle =
    !disabled && hover
      ? variant === "solid"
        ? { background: "var(--accent-hi)" }
        : { color: "var(--fg)", borderColor: "var(--border-str)" }
      : {};

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: s.box,
        height: s.box,
        display: "grid",
        placeItems: "center",
        borderRadius: "var(--radius-full)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        padding: 0,
        transition: "background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease)",
        ...v,
        ...hoverStyle,
        ...style,
      }}
      {...rest}
    >
      <Icon name={icon} size={s.icon} strokeWidth={2} />
    </button>
  );
}
