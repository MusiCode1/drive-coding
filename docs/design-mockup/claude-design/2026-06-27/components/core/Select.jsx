import React from "react";
import { Icon } from "./Icon.jsx";

/**
 * Select — styled native <select>. Matches the product: bg-elev surface,
 * hairline border, accent focus ring, custom chevron. Native for
 * accessibility + mobile pickers (drive-first).
 */
export function Select({
  value,
  options = [],
  onChange,
  disabled = false,
  ariaLabel,
  fullWidth = true,
  style,
}) {
  return (
    <div style={{ position: "relative", display: "inline-flex", width: fullWidth ? "100%" : undefined }}>
      <select
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange && onChange(e.target.value)}
        style={{
          appearance: "none",
          WebkitAppearance: "none",
          width: "100%",
          padding: "0.625rem 2.2rem 0.625rem 0.75rem",
          background: "var(--bg-elev)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          color: "var(--fg)",
          fontFamily: "var(--font)",
          fontSize: "var(--text-base)",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.6 : 1,
          ...style,
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} style={{ background: "var(--bg-elev)", color: "var(--fg)" }}>
            {o.label}
          </option>
        ))}
      </select>
      <span
        style={{
          position: "absolute",
          insetInlineEnd: "0.7rem",
          top: "50%",
          transform: "translateY(-50%)",
          color: "var(--fg-muted)",
          pointerEvents: "none",
        }}
      >
        <Icon name="chevron-down" size={16} />
      </span>
    </div>
  );
}
