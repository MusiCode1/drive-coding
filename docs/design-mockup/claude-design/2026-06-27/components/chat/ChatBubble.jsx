import React from "react";
import { Avatar } from "../core/Avatar.jsx";
import { IconButton } from "../core/IconButton.jsx";

/**
 * ChatBubble — a single conversation row: avatar + bubble, aligned by role.
 *
 * RTL-first product semantics: user sits at the inline-start, agent/thought
 * at the inline-end, each with one flattened "tail" corner. Thought bubbles
 * are dashed + italic. Pass `text` (string) or arbitrary `children`.
 */
export function ChatBubble({ kind = "agent", text, children, time, showAvatar = true, actions = [], dir = "auto", style }) {
  const isUser = kind === "user";
  const isThought = kind === "thought";

  const bubbleBase = {
    padding: "0.625rem 0.875rem",
    fontSize: "var(--text-base)",
    lineHeight: "var(--leading-normal)",
    borderRadius: "var(--radius-xl)",
    minWidth: 0,
    maxWidth: "100%",
    overflowWrap: "anywhere",
    whiteSpace: "pre-wrap",
  };

  const kindStyle = isThought
    ? {
        background: "transparent",
        border: "1px dashed var(--border-str)",
        color: "var(--fg-dim)",
        fontStyle: "italic",
        fontSize: "var(--text-sm)",
        borderRadius: "var(--radius-lg)",
      }
    : isUser
    ? { background: "var(--bubble-user)", borderEndStartRadius: "var(--radius-sm)" }
    : { background: "var(--bubble-agent)", borderEndEndRadius: "var(--radius-sm)" };

  return (
    <div
      style={{
        display: "flex",
        gap: "0.5rem",
        alignItems: "flex-end",
        maxWidth: "85%",
        alignSelf: isUser ? "flex-start" : "flex-end",
        flexDirection: isUser ? "row" : "row-reverse",
        ...style,
      }}
    >
      {showAvatar && <Avatar kind={kind} />}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem", alignItems: isUser ? "flex-start" : "flex-end", minWidth: 0 }}>
        {isThought && (
          <div style={{ fontSize: "var(--text-xs)", fontWeight: "var(--fw-semibold)", fontStyle: "normal", opacity: 0.7, marginBottom: "0.15rem", color: "var(--fg-dim)" }}>
            מחשבה
          </div>
        )}
        <div dir={dir} style={{ ...bubbleBase, ...kindStyle }}>
          {text != null ? text : children}
        </div>
        {time && (
          <span style={{ fontSize: "var(--text-xs)", color: "var(--fg-dim)", opacity: 0.6, direction: "ltr" }}>{time}</span>
        )}
      </div>
      {actions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", alignSelf: "flex-end" }}>
          {actions.map((a) => (
            <IconButton key={a.icon} icon={a.icon} size="xs" ariaLabel={a.label} onClick={a.onClick} />
          ))}
        </div>
      )}
    </div>
  );
}
