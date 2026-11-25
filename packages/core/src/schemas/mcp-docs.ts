/**
 * MCP server metadata and tool copy for POST /api/mcp (session-bus-mcp).
 * Kept in core so CLI, BE, and docs share one source of truth.
 */

export const MCP_SERVER_TITLE = "Drive Coding Session Bus"

/** Short blurb — shown in MCP server lists (initialize serverInfo.description). */
export const MCP_SERVER_DESCRIPTION =
  "Spawn and control ACP coding agents (Cursor, Claude, Codex, OpenCode, …) on this drive-coding backend. Use session_open → session_send → session_close."

/**
 * Long-form usage — returned in initialize (instructions). Agents that read this
 * get the full workflow without external docs.
 */

/** Returned on session_open so the catalog explains itself. */
export const MCP_CONFIGURE_HINT =
  'configOptions and modes are this CLI\'s live settings — not just model: also permission, agent persona, thinking, and whatever else it advertises. Each entry has id, a description, currentValue, and allowed values. To change any of them, pass sets: { "<id>": "<value>" } on session_send. Use only ids from this catalog. You opened this agent — you must session_close it when finished. If a turn is already running, wait until idle or pass force: true. Do not leave it live.'

export const MCP_AGENT_CONFIGURE_HINT =
  'Use agentId from this result as agent in session_state, session_send and session_close. Apply live configOptions/modes IDs with session_send.sets: { "<id>": "<value>" }. Close the agent when done; wait for idle or pass force: true.'

export const MCP_SERVER_INSTRUCTIONS = `# drive-coding MCP

Remote control for live ACP agents. Discover both tool vocabularies and their input schemas with \`tools/list\`. The workflow below uses \`session_*\`.

## Typical workflow

1. **session_list** — see agents already running on this backend (id, cliKind, cwd, turnState).
2. **session_open** — pass \`cli\` and absolute \`cwd\`. Wait for \`sessionId\` (up to 30s) and save the returned \`agent\` UUID.
3. **session_send** — send a user prompt to that \`agent\`; waits until the turn ends unless \`noWait\` or timeout.
4. **session_state** — inspect turnState, modes, configOptions, errors without pulling the full message log.
5. **session_close** — delete the agent and kill its CLI when finished.

Reuse an existing agent when appropriate. Close any agent you opened when finished.
If its turn is open, wait for idle or pass \`force: true\`.

## Configure the child

Read the CLI name, \`configOptions\` and \`modes.availableModes\` from open/state.
Apply live option IDs and allowed values via \`session_send.sets\` before the prompt.

## Identity header

When drive-coding injects this server into a child agent, requests include \`X-Drive-Coding-Agent: <uuid>\`.
That sets the parent for **session_open** (any explicit \`parent\` must match) and enables **notify_parent** for child agents.
Call **session_whoami** (no parameters) to discover your own agent UUID and runtime context from that header — the server does not guess from ENV.

When child RSS cannot be measured (Windows, stale pid, /proc failure): \`runtime.memory\` is \`null\` and \`runtime.source\` is \`"unavailable"\`. Child memory is Linux-only in v1.

The header supplies identity. See \`session_subscribe\` for subscriptions and \`session_surface\` for this agent’s UI and runtime instructions. Use \`session_note_set\`, \`session_field_set\` and \`session_field_delete\` to edit your record.

Scoped sends and closes target your subtree. Outside it, scope policy controls
permission escalation. A refusal returns \`scope-denied\`. Reads are unrestricted.

## Limits

- **Stateless HTTP** — no live push notifications; poll with session_state or session_send.
- **session_close** refuses when \`turnState !== idle\` unless \`force: true\`, and is subject to the scope rule above.
- **session_send** defaults to 1800s wait; \`file\`, \`marker\`, \`idleTimeoutSec\`, \`keep\` are ignored (CLI-only).
- Kill switch: backend owner sets \`MCP_HTTP=0\` to disable the endpoint.
`

export type McpToolName =
  | "session_list"
  | "session_open"
  | "session_send"
  | "session_state"
  | "session_close"
  | "session_subscribe"
  | "session_whoami"
  | "session_surface"
  | "session_note_set"
  | "session_field_set"
  | "session_field_delete"
  | "agent_list"
  | "agent_open"
  | "agent_send"
  | "agent_state"
  | "agent_close"
  | "agent_subscribe"
  | "agent_whoami"
  | "agent_surface"
  | "agent_note_set"
  | "agent_field_set"
  | "agent_field_delete"
  | "notify_parent"
  | "docs_get"

export const MCP_TOOL_ALIASES = {
  session_list: "agent_list",
  session_open: "agent_open",
  session_send: "agent_send",
  session_state: "agent_state",
  session_close: "agent_close",
  session_subscribe: "agent_subscribe",
  session_whoami: "agent_whoami",
  session_surface: "agent_surface",
  session_note_set: "agent_note_set",
  session_field_set: "agent_field_set",
  session_field_delete: "agent_field_delete",
} as const satisfies Partial<Record<McpToolName, McpToolName>>

type ToolMeta = { title: string; description: string }

function aliasMeta<T extends keyof typeof MCP_TOOL_ALIASES>(
  legacy: T,
  title: string,
  base: string,
  legacyFields = "",
  canonicalFields = "",
): Record<T | (typeof MCP_TOOL_ALIASES)[T], ToolMeta> {
  const canonical = MCP_TOOL_ALIASES[legacy]
  return {
    [legacy]: {
      title,
      description: [base, legacyFields, `Alternate name: ${canonical}.`].filter(Boolean).join(" "),
    },
    [canonical]: {
      title,
      description: [base, canonicalFields, `Alternate name: ${legacy}.`].filter(Boolean).join(" "),
    },
  } as Record<T | (typeof MCP_TOOL_ALIASES)[T], ToolMeta>
}

export const MCP_TOOL_META: Record<Exclude<McpToolName, "notify_parent">, ToolMeta> = {
  ...aliasMeta(
    "session_list",
    "List live agents",
    "List registered agents and live CLI status. Check before opening a duplicate.",
    "Legacy fields: userNotes, sessionFields, connectionCount.",
    "Canonical fields: agentNotes, agentFields, viewerCount.",
  ),
  ...aliasMeta(
    "session_open",
    "Open agent",
    "Wait up to 30s for sessionId. Inspect cli, modes and configOptions. Use session_send.sets with live IDs and session_close when finished.",
    "Input uses cli and cwd. Returns agent UUID in agent.",
    "Input uses cliKind and cwd. Use returned agentId as agent in the recommended workflow.",
  ),
  ...aliasMeta(
    "session_send",
    "Send prompt to agent",
    "Apply sets using live option IDs, then send a prompt. Wait up to timeoutSec (default 1800), or return { running: true } on timeout or noWait.",
    "Input uses agent.",
    "Input uses agentId.",
  ),
  ...aliasMeta(
    "session_state",
    "Read agent state",
    'Read selected host state, including the live options by default. Pass fields: ["*"] for the full snapshot.',
    "Input and result use agent.",
    "Input and result use agentId.",
  ),
  ...aliasMeta(
    "session_close",
    "Close agent",
    "Delete one agent and kill its CLI. Scope applies. Wait for idle or pass force. A missing record returns alreadyClosed.",
    "Input and result use agent.",
    "Input and result use agentId.",
  ),
  ...aliasMeta(
    "session_subscribe",
    "Subscribe to agent events",
    "Receive turn-ended and stall-suspected events. Repeated calls update options on the same subscription. The caller is the default subscriber.",
    "Inputs use agent and subscriber.",
    "Inputs use agentId and subscriberAgentId.",
  ),
  ...aliasMeta(
    "session_whoami",
    "Read caller identity",
    "Read caller identity, optional ACP sessionId, agent memory, backend and child runtime. Requires a registered X-Drive-Coding-Agent header. Child RSS may be unavailable.",
    "Identity uses agent.",
    "Identity uses agentId, agentNotes and agentFields.",
  ),
  ...aliasMeta(
    "session_surface",
    "Read agent surface prompt",
    "Read the same Markdown as GET /api/agent-prompt: runtime, chat rendering, capabilities, agent memory and charter. Requires caller identity.",
  ),
  ...aliasMeta(
    "session_note_set",
    "Set agent note",
    "Replace the caller’s entire note by header identity. Empty text clears it.",
  ),
  ...aliasMeta(
    "session_field_set",
    "Set agent field",
    "Set one field on the caller’s record by header identity. Field key must be nonempty after trim.",
  ),
  ...aliasMeta(
    "session_field_delete",
    "Delete agent field",
    "Remove one field on the caller’s record by header identity. A missing key is a successful no-op.",
  ),
  docs_get: {
    title: "Get agent documentation",
    description:
      "Read the full documentation catalog, search with tags or query, or pass id for Markdown.",
  },
}

export const MCP_NOTIFY_PARENT_META = {
  title: "Notify parent agent",
  description:
    "Push text as a prompt into the parent agent's live session. Only available when this MCP connection carries X-Drive-Coding-Agent and that agent has a parentAgentId. Fire-and-forget; returns { ok: true, parent }.",
}
