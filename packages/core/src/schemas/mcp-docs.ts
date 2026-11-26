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

Discover both tool vocabularies and their schemas with \`tools/list\`. The workflow here uses \`session_*\`.

## Typical workflow

1. **session_list** — find a live agent before spawning one.
2. **session_open** — pass \`cli\` and absolute \`cwd\`. Wait up to 30s for \`sessionId\` and save \`agent\`.
3. **session_send** — prompt that \`agent\`. Wait for completion, or continue after \`noWait\` or timeout.
4. **session_state** — inspect turnState, modes, configOptions and errors. Use \`fields: ["*"]\` for the full snapshot.
5. **session_close** — close the agent you opened when finished. Wait for idle or pass \`force: true\`.

Apply the live \`configOptions\` or mode IDs and allowed values with \`session_send.sets\`.

## Identity and scope

A registered \`X-Drive-Coding-Agent\` identifies the caller, sets the parent for **session_open** and enables **notify_parent** for child agents. An explicit parent must match the header.
**session_whoami** reads caller identity and runtime. Child RSS is Linux-only and can be unavailable.
**session_surface** reads UI and runtime instructions. Edit your record with \`session_note_set\`, \`session_field_set\` or \`session_field_delete\`.
Scope policy applies to writes outside your subtree. Denial returns \`scope-denied\`. Reads are unrestricted.

## Cancellation

Call **agent_cancel** with \`{agentId}\`. \`cancel-requested\` is best effort, with one provider request per active turn. Poll **session_state** for idle.
Idle, disconnected and switching sessions yield \`no-active-turn\`; call again once a turn is active.

## Subscriptions

**session_subscribe** takes \`agent\` and optional \`subscriber\`. **agent_unsubscribe** takes \`agentId\` and optional \`subscriberAgentId\`.
Both default to the caller as subscriber and check scope against the effective subscriber. Unsubscribe also removes subscriptions from \`notifyOnDone\`, even after an agent closes.

## Limits

- MCP HTTP is stateless. Poll state or wait on send for output.
- Send waits up to 1800s by default. \`file\`, \`marker\`, \`idleTimeoutSec\` and \`keep\` are CLI-only.
- Set \`MCP_HTTP=0\` to disable the endpoint.
`

export type McpToolName =
  | "session_list"
  | "session_open"
  | "session_send"
  | "session_state"
  | "session_close"
  | "session_subscribe"
  | "agent_cancel"
  | "agent_unsubscribe"
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
    "List live agents and CLI status before opening a duplicate.",
    "Legacy fields: userNotes, sessionFields, connectionCount.",
    "Canonical fields: agentNotes, agentFields, viewerCount.",
  ),
  ...aliasMeta(
    "session_open",
    "Open agent",
    "Wait up to 30s for sessionId. Use returned modes/configOptions in session_send.sets.",
    "Uses cli, cwd and optional notifyOnDone (subscribe scope). Returns agent.",
    "Uses cliKind, cwd and optional subscribeOnOpenAgentId (subscribe scope). Returns agentId.",
  ),
  ...aliasMeta(
    "session_send",
    "Send prompt to agent",
    "Apply sets, then prompt. Wait up to timeoutSec (default 1800), or return { running: true } on timeout or noWait.",
    "Input uses agent.",
    "Input uses agentId.",
  ),
  ...aliasMeta(
    "session_state",
    "Read agent state",
    'Read host state and live options. Pass fields: ["*"] for the full snapshot.',
    "Input and result use agent.",
    "Input and result use agentId.",
  ),
  ...aliasMeta(
    "session_close",
    "Close agent",
    "Close one agent and its CLI. Scope applies. Wait for idle or pass force. Missing agents return alreadyClosed.",
    "Input and result use agent.",
    "Input and result use agentId.",
  ),
  ...aliasMeta(
    "session_subscribe",
    "Subscribe to agent events",
    "Receive turn-ended and stall-suspected events. Calls update the same pair. Scope uses the subscriber, defaulting to the caller.",
    "Inputs use agent and subscriber.",
    "Inputs use agentId and subscriberAgentId.",
  ),
  ...aliasMeta(
    "session_whoami",
    "Read caller identity",
    "Read identity, ACP sessionId, memory and runtime. Requires registered X-Drive-Coding-Agent.",
    "Identity uses agent.",
    "Identity uses agentId, agentNotes and agentFields.",
  ),
  ...aliasMeta(
    "session_surface",
    "Read agent surface prompt",
    "Read the UI, runtime and charter prompt from GET /api/agent-prompt. Requires caller identity.",
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
  agent_cancel: {
    title: "Cancel the active turn",
    description:
      "Cancel agentId’s active turn using session/cancel scope. Best effort, once per turn. Returns no-active-turn during switches or when idle. Poll session_state for idle.",
  },
  agent_unsubscribe: {
    title: "Unsubscribe from agent events",
    description:
      "Remove events from agentId for the effective subscriber (defaults to caller). Uses unsubscribe scope. Removes pairs from notifyOnDone and succeeds if already absent.",
  },
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
