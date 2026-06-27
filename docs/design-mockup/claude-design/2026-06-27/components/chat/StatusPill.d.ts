import React from "react";

export interface StatusPillProps {
  /** Model phase. Default "thinking". */
  phase?: "waiting" | "thinking" | "responding" | "calling-tool" | "pending-tts" | "speaking";
  /** Override the default Hebrew label. */
  label?: string;
  style?: React.CSSProperties;
}

/**
 * Transient model-status pill (pulsing dot + label), agent-aligned, shown
 * above the chat while the agent is working.
 */
export function StatusPill(props: StatusPillProps): JSX.Element;
