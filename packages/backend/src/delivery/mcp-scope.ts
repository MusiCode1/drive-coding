/**
 * mcp-scope.ts — scoped-write wrapper for MCP write tools (C2).
 */

import type { AgentRegistry } from "@drive-coding/core"
import { guardMcpWrite, type ScopeEnforcementDeps } from "../bind-scope-enforcement.js"

export function runScopedMcpTool<T>(
  scopeToken: string | undefined,
  deps: ScopeEnforcementDeps,
  targetId: string,
  verb: string,
  run: () => Promise<T>,
  onDenied: () => T,
): Promise<T> {
  return guardMcpWrite(scopeToken, deps, targetId, verb).then((allowed) =>
    allowed ? run() : onDenied(),
  )
}

export type McpScopeDeps = ScopeEnforcementDeps & { registry: AgentRegistry }
