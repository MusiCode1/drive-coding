import React from "react";

/**
 * Toggle — the product's on/off switch (settings, car-mode, speaker mute).
 * 44×26 track; knob slides; ON fills with accent. RTL-aware (knob rests at
 * the inline-start edge).
 */
export function Toggle({ checked = false, onChange, disabled = false, ariaLabel, style }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => !disabled && onChange && onChange(!checked)}
      style={{
        position: "relative",
        width: 44,
        height: 26,
        flexShrink: 0,
        borderRadius: "var(--radius-full)",
        border: "none",
        padding: 0,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        background: checked ? "var(--accent)" : "var(--border-str)",
        transition: "background var(--dur-base) var(--ease)",
        ...style,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          insetInlineStart: checked ? "calc(100% - 23px)" : 3,
          width: 20,
          height: 20,
          borderRadius: "var(--radius-full)",
          background: checked ? "#fff" : "var(--fg)",
          transition: "inset-inline-start var(--dur-base) var(--ease)",
        }}
      />
    </button>
  );
}
