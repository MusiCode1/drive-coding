`ChatBubble` is one conversation row — avatar + bubble, aligned and colored by role. The core of the DriveCoding chat surface.

```jsx
<div style={{display:"flex", flexDirection:"column", gap:"var(--space-3)"}}>
  <ChatBubble kind="user" text="תקן את הבאג בלוגין" time="14:22" />
  <ChatBubble kind="thought" text="בודק את handler האימות…" />
  <ChatBubble kind="agent" text="מצאתי את הבעיה ותיקנתי." time="14:23"
    actions={[{icon:"copy",label:"העתק"},{icon:"play",label:"השמע"}]} />
</div>
```

`kind`: user (inline-start, bubble-user) / agent (inline-end, bubble-agent) / thought (dashed, italic). Pass `text` or `children`. `actions` renders xs IconButtons. Always lives in a flex column.
