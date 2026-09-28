/**
 * Surface prompt — product capabilities beyond the chat renderers
 * (MCP session bus, spawn/control, parent notify).
 */

export const SURFACE_CAPABILITIES = `
# drive-coding capabilities (session bus)

This backend exposes an **MCP server** for \`session_*\` tools on the same BE.
Use **session_list** before spawning duplicates. Do not invent config option ids —
use ids from \`session_open\` / \`session_state\`.

## Auto-wiring

If your CLI declared \`mcpCapabilities.http: true\` at initialize, drive-coding may
already have injected this MCP server into your session (loopback URL +
\`X-Drive-Coding-Agent\` header). Re-use \`session_list\` before spawning duplicates.

Every document is reachable without the repository: MCP tool \`docs_get\`, MCP
resources \`drive-coding://docs/<id>\`, or \`GET /api/docs\`.

For tool lists, Streamable HTTP endpoints, and limits, call
\`docs_get({id:"session-lifecycle"})\` and \`docs_get({id:"transports"})\`.
`.trim()
