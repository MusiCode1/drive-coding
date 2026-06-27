import React from "react";

export interface TextInputProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  /** Render a textarea (prompt composer). */
  multiline?: boolean;
  /** Textarea rows. Default 2. */
  rows?: number;
  disabled?: boolean;
  /** Surface tone. Default "elev". */
  surface?: "elev" | "card";
  /** Text direction. Default "auto" (bidi). */
  dir?: "auto" | "ltr" | "rtl";
  onKeyDown?: (e: React.KeyboardEvent) => void;
  ariaLabel?: string;
  style?: React.CSSProperties;
}

/** Single-line input or multi-line textarea with accent focus ring; bidi-ready. */
export function TextInput(props: TextInputProps): JSX.Element;
