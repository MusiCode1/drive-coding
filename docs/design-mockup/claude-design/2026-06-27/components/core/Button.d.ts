import React from "react";

export interface ButtonProps {
  children?: React.ReactNode;
  /** Visual style. Default "primary". */
  variant?: "primary" | "secondary" | "ghost" | "danger";
  /** Default "md". */
  size?: "sm" | "md" | "lg";
  /** Fully-rounded segmented-tab shape (footer mode toggle). */
  pill?: boolean;
  /** Leading icon name (see Icon). */
  icon?: string;
  /** Trailing icon name. */
  iconRight?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  type?: "button" | "submit" | "reset";
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  style?: React.CSSProperties;
}

/**
 * @startingPoint section="Core" subtitle="Primary action button with 4 variants" viewport="700x180"
 *
 * DriveCoding's action button: solid accent (primary), elevated outline
 * (secondary), bare (ghost), destructive (danger). Optional pill shape + icons.
 */
export function Button(props: ButtonProps): JSX.Element;
