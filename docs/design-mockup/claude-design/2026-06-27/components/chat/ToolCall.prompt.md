`ToolCall` renders an agent tool invocation as a collapsible card with a status dot and a human narration; expand to see the command and result.

```jsx
<ToolCall status="completed" narration="קראתי את auth/login.ts"
  command="cat src/auth/login.ts" result="export function login() { … }" />
<ToolCall status="in_progress" title="bash" command="pnpm test" defaultOpen />
```

`status`: pending / in_progress / completed / failed (drives the dot). Prefer `narration` for the header; `title` is the raw tool name fallback. `command`/`result` appear in the expanded mono panel.
