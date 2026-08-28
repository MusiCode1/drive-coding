/**
 * agent-identity.ts — shared constants + helpers (slice agent-identity-mcp).
 *
 * Same agentId travels on two channels: child env (`DRIVE_CODING_AGENT_ID`) and
 * MCP HTTP header (`X-Drive-Coding-Agent`). The header identifies the caller to
 * the server; it is not authentication.
 */

import type { NewSessionRequest } from "@agentclientprotocol/sdk"

/** Env var injected into spawned / in-process children so they know their agent id. */
export const DRIVE_CODING_AGENT_ID_ENV = "DRIVE_CODING_AGENT_ID"

/** HTTP header on MCP requests — caller identity, not auth (§4.2). */
export const AGENT_ID_HEADER = "X-Drive-Coding-Agent"

export const MCP_SERVER_NAME = "drive-coding"

export function buildAgentIdentityEnv(agentId: string): Record<string, string> {
  return { [DRIVE_CODING_AGENT_ID_ENV]: agentId }
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
      headers: [{ name: AGENT_ID_HEADER, value: agentId }],
    },
  ]
}
