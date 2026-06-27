import React from "react";

export interface BubbleAction {
  icon: string;
  label?: string;
  onClick?: () => void;
}

export interface ChatBubbleProps {
  /** Role — controls side, color, and avatar. Default "agent". */
  kind?: "user" | "agent" | "thought";
  /** Plain-text content (whitespace preserved). */
  text?: string;
  /** Rich content (overrides text). */
  children?: React.ReactNode;
  /** Timestamp string (rendered LTR). */
  time?: string;
  /** Show the role avatar. Default true. */
  showAvatar?: boolean;
  /** Hover/inline action chips (copy, play…). */
  actions?: BubbleAction[];
  /** Text direction. Default "auto" (bidi). */
  dir?: "auto" | "ltr" | "rtl";
  style?: React.CSSProperties;
}

/**
 * @startingPoint section="Chat" subtitle="User / agent / thought chat row" viewport="700x220"
 *
 * One conversation row. User aligns to inline-start, agent/thought to
 * inline-end, each with a flattened tail corner; thought is dashed + italic.
 * Place inside a flex column with `gap: var(--space-3)`.
 */
export function ChatBubble(props: ChatBubbleProps): JSX.Element;
