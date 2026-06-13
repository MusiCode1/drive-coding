/**
 * reap-idle.ts — testable helper לרעייפינג של bridges סרק.
 *
 * מחולץ מ-server.ts כדי לאפשר בדיקות יחידה/אינטגרציה ללא side-effects של server.
 * ה-server מייבא ומפעיל את reapIdleBridges בלבד.
 *
 * slice active-agents: מחריג agents נעוצים (persistent=true) — לא מוחק את בלוק ה-reaper,
 * משנה את ההתנהגות. bridges נעוצים מופיעים ב-listIdle אבל מדולגים כאן.
 */

import type { AgentRegistry } from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import type { AgentOrchestrator } from "../app/agent-orchestrator.js"

const reaperLog = createLogger("backend.reaper")

export type ReapIdleDeps = {
  bridgeManager: {
    listIdle(timeoutMs: number, now: number): string[]
  }
  registry: AgentRegistry
  orchestrator: {
    deleteAndKill(id: string): Promise<void>
  }
  timeoutMs: number
}

/**
 * reapIdleBridges — מריץ סבב ניקוי של bridges סרק.
 *
 * לוגיקה:
 * 1. listIdle → רשימת bridge IDs שעברו timeout
 * 2. לכל id: אם agent?.persistent === true → דלג (לא מוחק)
 * 3. אחרת: deleteAndKill (fire-and-forget עם catch)
 */
export async function reapIdleBridges(deps: ReapIdleDeps, now: number): Promise<void> {
  const idle = deps.bridgeManager.listIdle(deps.timeoutMs, now)
  for (const id of idle) {
    const agent = await deps.registry.get(id)
    if (agent?.persistent) {
      reaperLog.debug({ agentId: id }, "skip reaping pinned bridge")
      continue
    }
    reaperLog.info({ agentId: id }, "reaping idle bridge")
    await deps.orchestrator.deleteAndKill(id).catch((e) =>
      reaperLog.warn({ err: e, agentId: id }, "reap failed"),
    )
  }
}
