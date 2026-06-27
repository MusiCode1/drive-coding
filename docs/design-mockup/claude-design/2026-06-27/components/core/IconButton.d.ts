import React from "react";

export interface IconButtonProps {
  /** Icon name (see Icon). */
  icon: string;
  /** xs=22 (bubble chip), sm=32, md=44 (tap min), lg=56 (drive-first). Default "md". */
  size?: "xs" | "sm" | "md" | "lg";
  /** Default "soft". */
  variant?: "soft" | "solid" | "ghost" | "muted";
  ariaLabel?: string;
  disabled?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  style?: React.CSSProperties;
}

/**
 * Round, icon-only control: mic side-controls (stop/replay), bubble actions
 * (copy/play), and toolbar buttons. Always pass `ariaLabel`.
 */
export function IconButton(props: IconButtonProps): JSX.Element;
