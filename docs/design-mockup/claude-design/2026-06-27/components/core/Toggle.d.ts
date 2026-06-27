import React from "react";

export interface ToggleProps {
  checked?: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
  style?: React.CSSProperties;
}

/** On/off switch — 44×26 track, accent fill when on. Used in settings/car-mode. */
export function Toggle(props: ToggleProps): JSX.Element;
