/**
 * agent-prompt.ts — build full surface prompt text for an agent record + URL config.
 *
 * Shared by GET /api/agent-prompt, MCP session_surface, and createAndSpawn (codex).
 */

import { configDefault } from "@drive-coding/core/config/specs"
import {
  SURFACE_PROMPT_PIECES,
  buildSurfacePrompt,
  type SurfaceRuntimeInfo,
} from "./surface/index.js"
import { defaultPublicUrl, loopbackBaseUrl, type UrlConfig } from "../delivery/public-url.js"

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, "")
}

function parsePort(baseUrl: string, urlConfig: UrlConfig): number {
  try {
    const u = new URL(baseUrl)
    if (u.port) return Number(u.port)
    return u.protocol === "https:" ? 443 : 80
  } catch {
    return urlConfig.port ?? configDefault("port")
  }
}

export function buildAgentPromptText(
  opts: {
    agentId: string
    parentAgentId?: string
    /** slice charter-in-hook: the agent's own systemPrompt rides the same payload. */
    charter?: string
    userNotes?: string
    sessionFields?: Readonly<Record<string, string>>
  },
  urlConfig: UrlConfig,
): string {
  const base = stripTrailingSlash(loopbackBaseUrl(urlConfig))
  const publicBaseUrl =
    urlConfig.publicBaseUrl !== undefined && urlConfig.publicBaseUrl.length > 0
      ? stripTrailingSlash(defaultPublicUrl(urlConfig))
      : undefined

  const runtime: SurfaceRuntimeInfo = {
    baseUrl: base,
    port: parsePort(base, urlConfig),
    pid: process.pid,
    agentId: opts.agentId,
    parentAgentId: opts.parentAgentId,
    publicBaseUrl,
  }

  return buildSurfacePrompt({
    pieces: [...SURFACE_PROMPT_PIECES],
    runtime,
    charter: opts.charter,
    userNotes: opts.userNotes,
    sessionFields: opts.sessionFields,
  })
}
