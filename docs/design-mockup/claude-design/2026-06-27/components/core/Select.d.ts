import React from "react";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  value?: string;
  options: SelectOption[];
  onChange?: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  /** Fill the container width. Default true. */
  fullWidth?: boolean;
  style?: React.CSSProperties;
}

/**
 * Styled native <select> — bg-elev surface, hairline border, custom chevron.
 * Native element for mobile pickers and accessibility (drive-first).
 */
export function Select(props: SelectProps): JSX.Element;
