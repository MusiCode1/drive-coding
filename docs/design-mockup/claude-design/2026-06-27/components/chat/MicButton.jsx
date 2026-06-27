import React from "react";
import { Icon } from "../core/Icon.jsx";

/**
 * MicButton — the single large drive-first control (110px). One button drives
 * the whole voice loop; its color, icon, and animation encode the state machine:
 *   idle        accent,    mic
 *   recording   recording, mic     + halo pulse
 *   transcribing/thinking  thinking, spinner
 *   speaking    speaking,  volume  (dark glyph)
 *   cancelling  accent,    x       + fast flash
 * Disabled during transcribing/cancelling. A floating stop appears in speaking.
 */
const STATUS_TEXT = {
  idle: "לחצי על הכפתור כדי לדבר",
  recording: "מקליט…",
  transcribing: "מתמלל…",
  thinking: "מעבד…",
  speaking: "מקריא תשובה",
  cancelling: "מבטל…",
};

export function MicButton({ state = "idle", size = 110, onClick, onStop, showStatus = true, style }) {
  const disabled = state === "transcribing" || state === "cancelling";
  const isSpinning = state === "transcribing" || state === "thinking";

  const bg =
    state === "recording" ? "var(--recording)"
    : state === "speaking" ? "var(--speaking)"
    : isSpinning ? "var(--thinking)"
    : "var(--accent)";

  const fg = state === "speaking" ? "#111" : "#fff";
  const anim =
    state === "recording" ? "pulse-rec 1.2s infinite"
    : state === "cancelling" ? "flash-fast 0.3s infinite"
    : undefined;

  const iconName =
    state === "speaking" ? "volume-2"
    : isSpinning ? "loader"
    : state === "cancelling" ? "x"
    : "mic";

  const statusColor =
    state === "recording" ? "var(--recording)"
    : state === "speaking" ? "var(--speaking)"
    : isSpinning ? "var(--thinking)"
    : state === "cancelling" ? "var(--accent-hi)"
    : "var(--fg-dim)";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem", ...style }}>
      <div style={{ position: "relative", display: "grid", placeItems: "center", minHeight: size + 20 }}>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={STATUS_TEXT[state]}
          style={{
            width: size,
            height: size,
            borderRadius: "var(--radius-full)",
            border: "none",
            display: "grid",
            placeItems: "center",
            background: disabled && state === "cancelling" ? bg : bg,
            color: fg,
            cursor: disabled ? "not-allowed" : "pointer",
            boxShadow: "var(--shadow-mic)",
            transition: "transform var(--dur-fast) var(--ease), background var(--dur-base) var(--ease), box-shadow var(--dur-base) var(--ease)",
            animation: anim,
          }}
        >
          <Icon name={iconName} size={Math.round(size * 0.36)} strokeWidth={1.5} style={{ animation: isSpinning ? "spin 1s linear infinite" : undefined }} />
        </button>

        {state === "speaking" && (
          <button
            type="button"
            onClick={onStop}
            aria-label="עצור"
            style={{
              position: "absolute",
              insetInlineStart: `calc(50% + ${size / 2 + 4}px)`,
              bottom: 0,
              width: 36,
              height: 36,
              borderRadius: "var(--radius-full)",
              background: "var(--fg-muted)",
              color: "var(--bg)",
              border: "none",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
            }}
          >
            <Icon name="square" size={14} strokeWidth={2.5} />
          </button>
        )}
      </div>

      {showStatus && (
        <span style={{ fontSize: "var(--text-sm)", fontWeight: "var(--fw-medium)", color: statusColor }}>{STATUS_TEXT[state]}</span>
      )}
    </div>
  );
}
