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

If you are working inside the drive-coding repository, read \`docs/agents/20-session-lifecycle.md\`
and \`docs/agents/97-transports.md\` for tool lists, Streamable HTTP endpoints, and limits.
`.trim()
