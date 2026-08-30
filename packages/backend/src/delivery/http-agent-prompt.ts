/**
 * GET /api/agent-prompt — composed surface prompt for provider hooks.
 *
 * Query: agent=<uuid> (required) — same id as DRIVE_CODING_AGENT_ID /
 * X-Drive-Coding-Agent. Optional header X-Drive-Coding-Agent as fallback.
 *
 * Response: text/plain (never HTML). 404 if agent unknown. 400 if id missing.
 */

import type { AgentRegistry } from "@drive-coding/core"
import type { Hono } from "hono"
import { AGENT_ID_HEADER } from "../agent-identity.js"
import {
  SURFACE_PROMPT_PIECES,
  buildSurfacePrompt,
  type SurfaceRuntimeInfo,
} from "../prompts/index.js"
import { defaultPublicUrl, loopbackBaseUrl } from "./public-url.js"

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, "")
}

function parsePort(baseUrl: string): number {
  try {
    const u = new URL(baseUrl)
    if (u.port) return Number(u.port)
    return u.protocol === "https:" ? 443 : 80
  } catch {
    return Number(process.env.PORT ?? "4000")
  }
}

export function buildAgentPromptText(opts: {
  agentId: string
  parentAgentId?: string
}): string {
  const base = stripTrailingSlash(loopbackBaseUrl())
  const publicRaw = process.env.PUBLIC_BASE_URL
  const publicBaseUrl =
    publicRaw !== undefined && publicRaw.length > 0
      ? stripTrailingSlash(defaultPublicUrl())
      : undefined

  const runtime: SurfaceRuntimeInfo = {
    baseUrl: base,
    port: parsePort(base),
    pid: process.pid,
    agentId: opts.agentId,
    parentAgentId: opts.parentAgentId,
    publicBaseUrl,
  }

  return buildSurfacePrompt({
    pieces: [...SURFACE_PROMPT_PIECES],
    runtime,
  })
}

export function registerAgentPromptHttp(
  app: Hono,
  deps: { registry: AgentRegistry },
): void {
  app.get("/api/agent-prompt", async (c) => {
    const fromQuery = c.req.query("agent")?.trim()
    const fromHeader = c.req.header(AGENT_ID_HEADER)?.trim()
    const agentId =
      fromQuery && fromQuery.length > 0
        ? fromQuery
        : fromHeader && fromHeader.length > 0
          ? fromHeader
          : undefined

    if (agentId === undefined) {
      return c.text("missing agent id (query ?agent= or X-Drive-Coding-Agent)", 400)
    }

    const agent = await deps.registry.get(agentId)
    if (!agent) {
      return c.text(`unknown agent: ${agentId}`, 404)
    }

    const body = buildAgentPromptText({
      agentId: agent.id,
      parentAgentId: agent.parentAgentId,
    })

    return c.text(body, 200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    })
  })
}
