/**
 * Surface prompt — product capabilities beyond the chat renderers
 * (MCP session bus, spawn/control, parent notify).
 */

export const SURFACE_CAPABILITIES = `
# drive-coding capabilities (session bus)

This backend exposes an **MCP server** at \`POST/GET/DELETE {base}/api/mcp\`
(Streamable HTTP). Use it to spawn and control other ACP agents on the same BE.

## Tools

1. **session_list** — live agents (id, cliKind, cwd, turnState, …). No params.
2. **session_open** — \`cli\` + \`cwd\` → wait for sessionId; returns \`agent\`, modes,
   configOptions. **You open it, you must session_close it.**
3. **session_send** — prompt (+ optional \`sets\` for config options); waits for turn end
   unless \`noWait\` / timeout.
4. **session_state** — turnState / errors / catalog (default omits huge message logs).
5. **session_close** — delete + kill; refuses if turn busy unless \`force: true\`.
6. **notify_parent** — only if you are a child with a parent (identity header set).

Do not invent config option ids — use ids from \`session_open\` / \`session_state\`.

## Auto-wiring

If your CLI declared \`mcpCapabilities.http: true\` at initialize, drive-coding may
already have injected this MCP server into your session (loopback URL +
\`X-Drive-Coding-Agent\` header). Re-use \`session_list\` before spawning duplicates.

## Limits

- Stateless HTTP — no server→client push; poll \`session_state\` or wait on \`session_send\`.
- No BE authentication on this surface — treat the URL as trusted LAN / Access-gated.
- Kill switch: \`MCP_HTTP=0\` disables the endpoint.
`.trim()
