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
  "configOptions and modes are this CLI's live settings — not just model: also permission, agent persona, thinking, and whatever else it advertises. Each entry has id, a description, currentValue, and allowed values. To change any of them, pass sets: { \"<id>\": \"<value>\" } on session_send. Use only ids from this catalog. You opened this agent — you must session_close it when finished. If a turn is already running, wait until idle or pass force: true. Do not leave it live."

export const MCP_SERVER_INSTRUCTIONS = `# drive-coding MCP

Remote control for live ACP agent processes managed by a drive-coding backend.

## Typical workflow

1. **session_list** — see agents already running on this backend (id, cliKind, cwd, turnState).
2. **session_open** — spawn a new agent; wait for \`sessionId\` (up to 30s). Save the returned \`agent\` UUID.
3. **session_send** — send a user prompt to that \`agent\`; waits until the turn ends unless \`noWait\` or timeout.
4. **session_state** — inspect turnState, modes, configOptions, errors without pulling the full message log.
5. **session_close** — delete the agent and kill its CLI when finished.

Re-use an existing agent from session_list instead of opening duplicates when appropriate.

## You open it, you close it

Whoever calls **session_open** owns that agent. You must **session_close** it when you are done — including when a conversation is already in progress. If \`turnState\` is not idle, wait for the turn to end, or pass \`force: true\`. Do not leave spawned agents running.

## Configure the child (model, permissions, agent, …)

Do not guess keys. \`session_open\` (and \`session_state\`) return that CLI's live catalog:

- \`cli.displayName\` — which CLI this is
- \`configOptions\` — full ACP options (id, name/description, category, currentValue, allowed values)
- \`modes.availableModes\` — session modes (often permission / plan / bypass), each with id + description

To apply a change, pass those ids on \`session_send.sets\` before the prompt. If an option is missing, this CLI does not expose it over MCP.

## Identity header

When drive-coding injects this server into a child agent, requests include \`X-Drive-Coding-Agent: <uuid>\`.
That sets the caller identity for **session_open** (\`parentAgentId\`) and enables **notify_parent** for child agents.

There is **no authentication** — any client that can reach the URL can list, open, prompt, or close agents.

## Limits

- **Stateless HTTP** — no live push notifications; poll with session_state or session_send.
- **session_close** refuses when \`turnState !== idle\` unless \`force: true\`. Any caller can close any agent by id.
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
  | "notify_parent"

export const MCP_TOOL_META: Record<
  Exclude<McpToolName, "notify_parent">,
  { title: string; description: string }
> = {
  session_list: {
    title: "List live agents",
    description:
      "Return every agent currently registered on this backend: id, cliKind, cwd, status, turnState, pid, attached. Same data as GET /api/agents. No parameters. Use before session_open to avoid duplicate spawns.",
  },
  session_open: {
    title: "Open agent session",
    description:
      "Spawn a new ACP CLI agent and block until sessionId exists (30s cap). Returns { agent, sessionId, url, cli, modes, configOptions, hint }. You own this agent: call session_close when done, even if a turn is already running (wait for idle, or force). cli.displayName identifies the CLI. modes and configOptions are the live catalog (model, permission, agent persona, thinking, …) — pass those ids as session_send.sets. Required: cli (e.g. cursor, claude, codex), cwd (absolute path).",
  },
  session_send: {
    title: "Send prompt to agent",
    description:
      "Run host.prompt and wait for turn end (default timeout 1800s). Returns { stopReason, text, messagesSince, lastTurnError } on completion, or { running: true } when noWait or timeout. Requires agent id from session_open or session_list. Optional sets applies that CLI's configOptions/modes (model, permission, agent, …) before the prompt — keys are option ids from session_open, not guessed names. Does not auto-close — the opener must session_close.",
  },
  session_state: {
    title: "Read agent state",
    description:
      "Read in-process host.state for one agent. Default includes modes and configOptions (the live catalog with descriptions). Default omits messages/commands (large). Pass fields: [\"*\"] for full snapshot, or a subset like [\"turnState\", \"title\"]. Requires agent id.",
  },
  session_close: {
    title: "Close agent session",
    description:
      "Delete the agent record and kill its CLI process (deleteAndKill). Refuses when turnState is not idle unless force: true — wait for the turn to finish or pass force. Missing agent returns { ok: true, alreadyClosed: true }. No ownership check: any caller can close any agent id.",
  },
  session_subscribe: {
    title: "Subscribe to agent events",
    description:
      "Register the caller (or an explicit subscriber UUID) to receive turn-ended and stall-suspected events for the target agent. Duplicate subscribe with the same options is a no-op; repeating with new options (e.g. includeLastAssistantText) updates the subscription. Requires agent (target). subscriber defaults to X-Drive-Coding-Agent when present.",
  },
}

export const MCP_NOTIFY_PARENT_META = {
  title: "Notify parent agent",
  description:
    "Push text as a prompt into the parent agent's live session. Only available when this MCP connection carries X-Drive-Coding-Agent and that agent has a parentAgentId. Fire-and-forget; returns { ok: true, parent }.",
}
