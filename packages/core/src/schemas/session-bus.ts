import { type } from "arktype"

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
  cli: "string >= 1",
  cwd: "string >= 1",
  "env?": { "[string]": "string" },
  "permission?": "string",
  "parent?": "string",
  "base?": "string",
  "port?": "number",
  "json?": "boolean",
  "publicUrl?": "string",
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
  agent: "string >= 1",
  prompt: "string",
  "sets?": { "[string]": "string" },
  "file?": "string",
  "marker?": "string",
  "timeoutSec?": "number",
  "idleTimeoutSec?": "number",
  "noWait?": "boolean",
  "keep?": "boolean",
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
  agent: "string >= 1",
  text: "string >= 1",
})
export type AgentNotifyInput = typeof AgentNotifyInput.infer

export const AgentCloseInput = type({
  agent: "string >= 1",
  "force?": "boolean",
})
export type AgentCloseInput = typeof AgentCloseInput.infer

export const AgentStateInput = type({
  agent: "string >= 1",
})
export type AgentStateInput = typeof AgentStateInput.infer

export const AgentListInput = type({
  "json?": "boolean",
  "base?": "string",
  "port?": "number",
})
export type AgentListInput = typeof AgentListInput.infer
