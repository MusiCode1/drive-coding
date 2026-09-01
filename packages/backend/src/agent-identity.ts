/**
 * agent-identity.ts — shared constants + helpers (slice agent-identity-mcp).
 *
 * Same agentId travels on two channels: child env (`DRIVE_CODING_AGENT_ID`) and
 * MCP HTTP header (`X-Drive-Coding-Agent`). The header identifies the caller to
 * the server; it is not authentication.
 */

import type { NewSessionRequest } from "@agentclientprotocol/sdk"
import { DC_TOKEN_ENV, issueToken, SCOPE_HEADER } from "./agent-scope.js"

/** Minimal shape from ACP initialize — only what we need for MCP gating. */
export type AgentMcpCapabilities = {
  mcpCapabilities?: { http?: boolean; sse?: boolean } | null
}

/** True when the agent declared HTTP MCP support in initialize. */
export function agentDeclaresHttpMcp(caps: AgentMcpCapabilities | undefined | null): boolean {
  const mcp = caps?.mcpCapabilities
  return mcp != null && mcp.http === true
}

/** Env var injected into spawned / in-process children so they know their agent id. */
export const DRIVE_CODING_AGENT_ID_ENV = "DRIVE_CODING_AGENT_ID"

/** HTTP header on MCP requests — caller identity, not auth (§4.2). */
export const AGENT_ID_HEADER = "X-Drive-Coding-Agent"

export const MCP_SERVER_NAME = "drive-coding"

export function buildAgentIdentityEnv(agentId: string): Record<string, string> {
  return {
    [DRIVE_CODING_AGENT_ID_ENV]: agentId,
    [DC_TOKEN_ENV]: issueToken(agentId),
  }
}

/** Loopback self URL for child MCP wiring — always 127.0.0.1 regardless of bind host (§4.4). */
export function buildAgentMcpServers(
  agentId: string,
  baseUrl: string,
): NewSessionRequest["mcpServers"] {
  const url = `${baseUrl.replace(/\/$/, "")}/api/mcp`
  return [
    {
      type: "http",
      name: MCP_SERVER_NAME,
      url,
      headers: [
        { name: AGENT_ID_HEADER, value: agentId },
        { name: SCOPE_HEADER, value: issueToken(agentId) },
      ],
    },
  ]
}

/**
 * MCP wiring for session/new|load — only when the agent declared http MCP in initialize.
 * Returns undefined when not injecting; callers should pass `?? []` so the ACP wire
 * always carries a required array (some older paths omitted the field entirely).
 * `baseUrl` may be a thunk so callers can avoid resolving listen URL when MCP is omitted.
 */
export function optionalAgentMcpServers(
  agentId: string,
  baseUrl: string | (() => string),
  caps: AgentMcpCapabilities | undefined | null,
): NewSessionRequest["mcpServers"] | undefined {
  if (!agentDeclaresHttpMcp(caps)) return undefined
  const url = typeof baseUrl === "function" ? baseUrl() : baseUrl
  return buildAgentMcpServers(agentId, url)
}
