import React from "react";

export interface BadgeProps {
  children?: React.ReactNode;
  /** Default "neutral". */
  tone?: "neutral" | "accent" | "connected" | "connecting" | "error";
  /** Show a leading status dot. */
  dot?: boolean;
  style?: React.CSSProperties;
}

/** Small status/label pill — agent connection status, counts, tags. */
export function Badge(props: BadgeProps): JSX.Element;
