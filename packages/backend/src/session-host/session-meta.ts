/**
 * session-meta.ts — resolve _meta for ACP session/new|load from effective CliSpec.
 */

import type { NewSessionRequest } from "@agentclientprotocol/sdk"
import {
  optionalAgentMcpServers,
  type AgentMcpCapabilities,
} from "../agent-identity.js"
import { getCliSpec } from "@drive-coding/provider/config"

/** Returns the `_meta` payload for this cliKind, or undefined when not configured. */
export function resolveSessionMeta(
  cliKind: string,
  env?: NodeJS.ProcessEnv,
): Record<string, unknown> | undefined {
  return getCliSpec(cliKind, env)?.sessionMeta
}

/** MCP injection toggle from cli-specs (undefined = inject). */
export function resolveInjectDriveCodingMcp(
  cliKind: string,
  env?: NodeJS.ProcessEnv,
): boolean | undefined {
  return getCliSpec(cliKind, env)?.injectDriveCodingMcp
}

/** Session/new|load base payload: cwd, mcpServers, optional _meta — from cli-specs. */
export function buildSessionInitBase(
  cliKind: string,
  agentId: string,
  cwd: string,
  caps: AgentMcpCapabilities | undefined | null,
  getBaseUrl: string | (() => string),
  env?: NodeJS.ProcessEnv,
): { cwd: string; mcpServers: NonNullable<NewSessionRequest["mcpServers"]> } & Record<
  string,
  unknown
> {
  const injectMcp = resolveInjectDriveCodingMcp(cliKind, env)
  const mcpServers =
    optionalAgentMcpServers(agentId, getBaseUrl, caps, {
      ...(injectMcp !== undefined ? { injectDriveCodingMcp: injectMcp } : {}),
    }) ?? []
  const sessionMeta = resolveSessionMeta(cliKind, env)
  return {
    cwd,
    mcpServers,
    ...(sessionMeta !== undefined ? { _meta: sessionMeta } : {}),
  }
}
