import { type } from "arktype"

const reqStr = (description: string) => type("string >= 1").describe(description)
const optStr = (description: string) => type("string").describe(description)
const optBool = (description: string) => type("boolean").describe(description)
const optNum = (description: string) => type("number").describe(description)

/** On-disk record written after listen. Shared by the CLI discovery path. */
export const InstanceRecord = type({
  port: "number",
  host: "string",
  pid: "number",
  version: "string",
  cwd: "string",
  https: "boolean",
  startedAt: "number",
})
export type InstanceRecord = typeof InstanceRecord.infer

export const HealthBody = type({
  status: "string",
  version: "string",
  uptime: "number",
  "service?": "string",
})
export type HealthBody = typeof HealthBody.infer

export const AgentOpenInput = type({
  cli: reqStr(
    "ACP CLI kind to spawn (cliKind), e.g. cursor, claude, codex, opencode.",
  ),
  cwd: reqStr("Absolute working directory for the new agent process."),
  "env?": type({ "[string]": "string" }).describe(
    "Extra environment variables merged into the child (after drive-coding injects DRIVE_CODING_BASE / DC_BASE).",
  ),
  "permission?": optStr(
    "Permission policy for the new agent (permissionPolicy), e.g. allow_once, bypassPermissions.",
  ),
  "parent?": optStr(
    "Parent agent UUID for sub-agent wiring (parentAgentId). Ignored when X-Drive-Coding-Agent header is set to a different id.",
  ),
  "closeOnTurnEnd?": optBool(
    "When true, automatically close this agent after its first clean turn end.",
  ),
  "base?": optStr(
    "Public base URL of this drive-coding backend (legacy alias for publicUrl). Used to build chat url and DC_BASE env.",
  ),
  "port?": optNum("Ignored over MCP — use publicUrl/base for the backend URL."),
  "json?": optBool("Ignored over MCP — MCP always returns JSON in content[].text."),
  "publicUrl?": optStr(
    "Public base URL of this drive-coding backend, e.g. http://127.0.0.1:4001. Default: loopback on PORT.",
  ),
  "systemPrompt?": type("string | null").describe(
    "Optional project charter (system prompt) forwarded to createAndSpawn — same as POST /api/agents.",
  ),
})
export type AgentOpenInput = typeof AgentOpenInput.infer

export const AgentOpenResult = type({
  agent: "string",
  sessionId: "string",
  url: "string",
  "modes?": "unknown",
  "configOptions?": "unknown",
})
export type AgentOpenResult = typeof AgentOpenResult.infer

export const AgentSendInput = type({
  agent: reqStr("Target agent UUID from session_open or session_list."),
  prompt: type("string").describe("User prompt text sent to the agent for this turn."),
  "sets?": type({ "[string]": "string" }).describe(
    "Settings to apply via setConfigOption before the prompt. Keys MUST be option ids from that agent's configOptions (or mode ids from modes) returned by session_open/session_state — e.g. model, permission, agent persona. Do not invent keys; read each option's description and allowed values.",
  ),
  "file?": optStr("Ignored over MCP (CLI-only: read prompt from file)."),
  "marker?": optStr("Ignored over MCP (CLI-only: completion marker in output)."),
  "timeoutSec?": optNum(
    "Max seconds to wait for turn end (default 1800). On timeout returns { running: true } while the turn continues.",
  ),
  "idleTimeoutSec?": optNum("Ignored over MCP (CLI-only idle timeout)."),
  "noWait?": optBool(
    "When true, dispatch the prompt and immediately return { running: true } without waiting for turn end.",
  ),
  "keep?": optBool("Ignored over MCP (CLI-only: keep agent open after send)."),
})
export type AgentSendInput = typeof AgentSendInput.infer

export const WaitForTurnEndResult = type({
  code: type.enumerated(0, 2, 3, 5),
  why: "string",
  "stopReason?": "string",
  frames: "number",
  lastState: "string",
})
export type WaitForTurnEndResult = typeof WaitForTurnEndResult.infer

export const AgentNotifyInput = type({
  agent: reqStr("Target agent UUID to notify."),
  text: reqStr("Notification text delivered as a prompt to that agent."),
})
export type AgentNotifyInput = typeof AgentNotifyInput.infer

/** MCP notify_parent — text only; caller identity from X-Drive-Coding-Agent header. */
export const AgentNotifyParentInput = type({
  text: reqStr("Message pushed as a prompt into the parent agent's live session."),
})
export type AgentNotifyParentInput = typeof AgentNotifyParentInput.infer

export const AgentCloseInput = type({
  agent: reqStr("Agent UUID to delete and kill."),
  "force?": optBool(
    "When true, close even if turnState is not idle. Default: refuse while a turn is open.",
  ),
})
export type AgentCloseInput = typeof AgentCloseInput.infer

export const AgentStateInput = type({
  agent: reqStr("Agent UUID to read state for."),
})
export type AgentStateInput = typeof AgentStateInput.infer

/** MCP session_list — no parameters (HTTP discovery flags are CLI-only). */
export const McpSessionListInput = type({})
export type McpSessionListInput = typeof McpSessionListInput.infer

/** @deprecated Use McpSessionListInput — base/port/json are not used by MCP. */
export const AgentListInput = McpSessionListInput
export type AgentListInput = McpSessionListInput

/** MCP session_state — optional field projection on top of AgentStateInput. */
export const SessionStateMcpInput = AgentStateInput.and({
  "fields?": type("string[]").describe(
    'State keys to return. Default omits messages/commands. Use ["*"] for the full host.state snapshot.',
  ),
})
export type SessionStateMcpInput = typeof SessionStateMcpInput.infer
