import React from "react";

export interface ToolCallProps {
  /** Lifecycle — drives the status dot. Default "completed". */
  status?: "pending" | "in_progress" | "completed" | "failed";
  /** Human-readable summary (preferred header). */
  narration?: string;
  /** Raw tool name, shown mono if no narration. */
  title?: string;
  /** Command / args, rendered $-prefixed mono when expanded. */
  command?: string;
  /** Result text, rendered mono when expanded. */
  result?: string;
  /** Start expanded. Default false. */
  defaultOpen?: boolean;
  style?: React.CSSProperties;
}

/**
 * Collapsible tool-invocation card (agent side). Header shows a status dot
 * and narration/title; expanding reveals command + result in mono. Self-manages
 * open state.
 */
export function ToolCall(props: ToolCallProps): JSX.Element;
