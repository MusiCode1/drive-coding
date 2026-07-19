/**
 * quota-handler.ts — creates the `_drive/getQuota` ext handler for claude in-process hosts.
 *
 * A single handler factory wired into BOTH in-process paths (in-process-host.ts +
 * connection/connect-in-process.ts) — no duplicate normalizer, no duplicate wiring logic
 * (brief §4 Commit 3 Tests: "שני נתיבי in-process מקבלים את אותו handler").
 */

import type { ClaudeAcpAgent } from "@agentclientprotocol/claude-agent-acp"
import { RequestError } from "@agentclientprotocol/sdk"
import type { GetQuotaResult } from "../../extensions/index.js"
import { parseExtParams, parseExtResult } from "../../extensions/index.js"
import { getQuery } from "./query-access.js"
import { normalizeClaudeQuota } from "./quota.js"

/**
 * Creates the `_drive/getQuota` handler.
 *
 * `getAgent` is a closure supplied by the host — returns the currently-live
 * ClaudeAcpAgent instance (or undefined before start()/onConnect). Each host owns
 * its own `claudeAgent` variable; passing a getter (instead of the agent itself)
 * lets this one handler be created once and stay correct across reconnects.
 */
export function createClaudeQuotaHandler(
  getAgent: () => ClaudeAcpAgent | undefined,
): (params: unknown) => Promise<GetQuotaResult> {
  return async (params: unknown): Promise<GetQuotaResult> => {
    let parsed: ReturnType<typeof parseExtParams<"_drive/getQuota">>
    try {
      parsed = parseExtParams("_drive/getQuota", params)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw RequestError.invalidParams({}, msg)
    }

    const agent = getAgent()
    if (!agent) throw new Error("_drive/getQuota called before start()")

    const query = getQuery(agent, parsed.sessionId)
    const raw = await query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()
    const snapshot = normalizeClaudeQuota(raw)

    // Validate our own output against the generic contract before it leaves the
    // provider boundary — defense-in-depth against a malformed normalizer output
    // reaching the FE unvalidated (brief §6 "top-level null סותר transport").
    return parseExtResult("_drive/getQuota", { snapshot })
  }
}
