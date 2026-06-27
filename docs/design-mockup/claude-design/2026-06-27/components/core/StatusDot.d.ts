import React from "react";

export interface StatusDotProps {
  /** Tool-call lifecycle. Default "pending". */
  status?: "pending" | "in_progress" | "completed" | "failed";
  /** Diameter in px. Default 8. */
  size?: number;
  style?: React.CSSProperties;
}

/**
 * Fixed-semantic status dot for tool calls: grey pending, orange pulsing
 * in_progress, green completed, red failed. Colors are intentionally not
 * theme-tinted so they read the same across all palettes.
 */
export function StatusDot(props: StatusDotProps): JSX.Element;
