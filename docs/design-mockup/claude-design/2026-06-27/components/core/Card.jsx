import React from "react";

/**
 * Card — elevated surface used for dashboard agent rows, settings groups,
 * and active-process panels. `interactive` adds hover lift + pointer.
 */
export function Card({ children, interactive = false, padding = "1rem", as = "div", onClick, style, ...rest }) {
  const [hover, setHover] = React.useState(false);
  const Tag = as;
  return (
    <Tag
      onClick={onClick}
      onMouseEnter={() => interactive && setHover(true)}
      onMouseLeave={() => interactive && setHover(false)}
      style={{
        position: "relative",
        background: "var(--bg-elev)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding,
        transition: "border-color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease)",
        cursor: interactive ? "pointer" : undefined,
        ...(interactive && hover
          ? { borderColor: "var(--border-str)", background: "var(--bg-card)", transform: "translateY(-1px)" }
          : {}),
        ...style,
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
