import React from "react";

export interface MicButtonProps {
  /** Voice state machine. Default "idle". */
  state?: "idle" | "recording" | "transcribing" | "thinking" | "speaking" | "cancelling";
  /** Diameter in px. Default 110 (drive-first). */
  size?: number;
  /** Press handler (toggle record / interrupt). */
  onClick?: () => void;
  /** Stop handler — used by the floating stop shown during speaking. */
  onStop?: () => void;
  /** Show Hebrew status text below. Default true. */
  showStatus?: boolean;
  style?: React.CSSProperties;
}

/**
 * @startingPoint section="Chat" subtitle="The 110px voice state-machine button" viewport="700x240"
 *
 * The one big drive-first control. Color + icon + animation encode the state:
 * idle/accent, recording/halo-pulse, transcribing-thinking/spinner, speaking/
 * green+stop, cancelling/flash. Disabled in transcribing & cancelling.
 */
export function MicButton(props: MicButtonProps): JSX.Element;
