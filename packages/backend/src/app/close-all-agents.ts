/**
 * close-all-agents.ts — ending every agent at once.
 *
 * Separate from the orchestrator because the interesting part is the failure
 * shape, not the loop.
 *
 * 🔴 Independent per agent, and reported per agent. A sequential loop that
 * throws would leave every agent after the failing one still running, and a
 * result that is only a count would hide which one it was — for an operation
 * whose whole purpose is "make sure nothing is left", both are the wrong answer.
 */

import { createLogger } from "@drive-coding/core/log"

const log = createLogger("backend.agents.close-all")

export type CloseAllResult = {
  closed: string[]
  failed: Array<{ id: string; error: string }>
}

export async function closeAllAgents(
  list: () => Promise<ReadonlyArray<{ id: string }>>,
  closeOne: (id: string) => Promise<void>,
): Promise<CloseAllResult> {
  const agents = await list()
  const results = await Promise.allSettled(agents.map((a) => closeOne(a.id)))

  const closed: string[] = []
  const failed: Array<{ id: string; error: string }> = []
  for (const [i, r] of results.entries()) {
    const id = agents[i]?.id ?? "unknown"
    if (r.status === "fulfilled") closed.push(id)
    else failed.push({ id, error: r.reason instanceof Error ? r.reason.message : String(r.reason) })
  }

  log.info({ closed: closed.length, failed: failed.length }, "close-all complete")
  return { closed, failed }
}
