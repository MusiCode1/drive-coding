import React from "react";

export interface AvatarProps {
  /** Chat role. Default "agent". */
  kind?: "user" | "agent" | "thought" | "tool";
  /** Diameter in px. Default 28. */
  size?: number;
  style?: React.CSSProperties;
}

/**
 * Round identity chip for a chat row — Lucide icon on a soft accent/thinking
 * tint, keyed by bubble kind (user, agent, thought, tool).
 */
export function Avatar(props: AvatarProps): JSX.Element;
