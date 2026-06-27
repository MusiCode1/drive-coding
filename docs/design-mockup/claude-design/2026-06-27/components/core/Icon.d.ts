import React from "react";
import { Icon } from "./Icon.jsx";

export interface IconProps {
  /** Lucide icon name from the curated set. */
  name:
    | "mic" | "mic-off" | "volume-2" | "square" | "loader" | "x" | "send"
    | "user" | "sparkles" | "brain" | "wrench" | "copy" | "check" | "play"
    | "folder" | "keyboard" | "eye-off" | "chevron-down" | "settings"
    | "plus" | "trash-2" | "refresh-cw" | "car";
  /** Pixel size (width = height). Default 18. */
  size?: number;
  /** Stroke weight. Default 1.75 — the product standard. */
  strokeWidth?: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * DriveCoding's icon primitive — a self-contained subset of Lucide outline
 * icons at the product's standard 1.75 stroke. Inherits currentColor.
 */
export function Icon(props: IconProps): JSX.Element | null;

/** All available icon names. */
export const ICON_NAMES: string[];
