import React from "react";

/**
 * TextInput — single-line input (paths, search) or multi-line textarea
 * (prompt composer). Matches the product: bg-elev/bg-card surface, hairline
 * border, accent focus ring. Defaults dir="auto" for bidi text.
 */
export function TextInput({
  value,
  onChange,
  placeholder,
  multiline = false,
  rows = 2,
  disabled = false,
  surface = "elev",
  dir = "auto",
  onKeyDown,
  ariaLabel,
  style,
}) {
  const [focus, setFocus] = React.useState(false);
  const base = {
    width: "100%",
    padding: "0.625rem 0.75rem",
    background: surface === "card" ? "var(--bg-card)" : "var(--bg-elev)",
    border: `1px solid ${focus ? "var(--accent)" : "var(--border)"}`,
    borderRadius: "var(--radius-lg)",
    color: "var(--fg)",
    fontFamily: "var(--font)",
    fontSize: "var(--text-base)",
    outline: "none",
    boxShadow: focus ? "0 0 0 2px var(--accent-soft)" : "none",
    transition: "border-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease)",
    ...style,
  };
  const common = {
    value,
    placeholder,
    disabled,
    dir,
    "aria-label": ariaLabel,
    onChange: (e) => onChange && onChange(e.target.value),
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    onKeyDown,
  };
  return multiline ? (
    <textarea {...common} rows={rows} style={{ ...base, resize: "none" }} />
  ) : (
    <input type="text" {...common} style={base} />
  );
}
