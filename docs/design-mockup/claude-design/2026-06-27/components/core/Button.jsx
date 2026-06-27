import React from "react";
import { Icon } from "./Icon.jsx";

/**
 * Button — DriveCoding's primary action control.
 *
 * Variants mirror the product: solid accent (primary), elevated outline
 * (secondary), bare (ghost), and destructive (danger, reconnect/delete).
 * `pill` gives the fully-rounded segmented-tab shape used in the footer.
 */
export function Button({
  children,
  variant = "primary",
  size = "md",
  pill = false,
  icon,
  iconRight,
  disabled = false,
  fullWidth = false,
  type = "button",
  onClick,
  style,
  ...rest
}) {
  const sizes = {
    sm: { padding: "0.4rem 0.75rem", fontSize: "var(--text-xs)", gap: "0.35rem", icon: 13, minH: 32 },
    md: { padding: "0.6rem 1rem", fontSize: "var(--text-md)", gap: "0.45rem", icon: 16, minH: 40 },
    lg: { padding: "0.85rem 1.4rem", fontSize: "var(--text-lg)", gap: "0.55rem", icon: 20, minH: 52 },
  };
  const s = sizes[size] || sizes.md;

  const variants = {
    primary: { background: "var(--accent)", color: "#fff", border: "1px solid transparent" },
    secondary: { background: "var(--bg-elev)", color: "var(--fg)", border: "1px solid var(--border)" },
    ghost: { background: "transparent", color: "var(--fg-dim)", border: "1px solid transparent" },
    danger: { background: "var(--recording)", color: "#fff", border: "1px solid transparent" },
  };
  const v = variants[variant] || variants.primary;

  const [hover, setHover] = React.useState(false);
  const hoverStyle =
    !disabled && hover
      ? variant === "primary"
        ? { background: "var(--accent-hi)" }
        : variant === "secondary"
        ? { borderColor: "var(--border-str)", color: "var(--fg)" }
        : variant === "ghost"
        ? { background: "var(--accent-soft)", color: "var(--fg)" }
        : { filter: "brightness(1.08)" }
      : {};

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: s.gap,
        padding: s.padding,
        minHeight: s.minH,
        width: fullWidth ? "100%" : undefined,
        fontFamily: "var(--font)",
        fontSize: s.fontSize,
        fontWeight: "var(--fw-semibold)",
        lineHeight: 1,
        borderRadius: pill ? "var(--radius-full)" : "var(--radius-md)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        transition: "background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease), filter var(--dur-fast) var(--ease)",
        ...v,
        ...hoverStyle,
        ...style,
      }}
      {...rest}
    >
      {icon && <Icon name={icon} size={s.icon} strokeWidth={2} />}
      {children}
      {iconRight && <Icon name={iconRight} size={s.icon} strokeWidth={2} />}
    </button>
  );
}
