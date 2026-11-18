/**
 * shutdown-policy.ts — what happens to running agents when the backend stops.
 *
 * ─── Why the default is "leave them" ─────────────────────────────────────────
 *
 * The kill-tree machinery exists for a good reason. From the plan that built it:
 * closing drive-coding left children *alive and unreachable*, so killing them was
 * the only honest option. The sidecar removes the second half of that sentence —
 * the agent is still reachable through its socket afterwards — and with it the
 * reason to kill.
 *
 * So the default is now to leave everything running. The backend comes back in
 * seconds, finds the sockets, and re-attaches.
 *
 * ⚠️ Order matters and is not negotiable: flipping this default *before* the
 * sidecar route works reproduces the original bug exactly. Which is why this
 * only ever applies to connections that can survive — a spawned child's stdio
 * dies with us no matter what this says, and `close()` on that kind of
 * connection means kill because there is nothing else it could mean.
 *
 * ─── Why there is no prompt on SIGTERM ───────────────────────────────────────
 *
 * `systemctl restart` arrives as SIGTERM with no terminal and nobody watching,
 * and any delay is cut short by `TimeoutStopSec`. There is no one to ask. A
 * terminal Ctrl+C is different — there is a human right there — so that path may
 * ask, and only that path.
 */

export type ShutdownDisposition = "leave-running" | "kill-all" | "ask"

/**
 * Decide what a shutdown should do with live agents.
 *
 * `SHUTDOWN_KILLS_AGENTS=1` forces the old behaviour for anyone who wants it.
 * Otherwise an interactive SIGINT asks and everything else leaves them running.
 */
export function shutdownDisposition(opts: {
  signal: string
  env?: NodeJS.ProcessEnv
  isTty?: boolean
}): ShutdownDisposition {
  const env = opts.env ?? process.env
  const forced = env.SHUTDOWN_KILLS_AGENTS
  if (forced === "1" || forced?.toLowerCase() === "true") return "kill-all"
  if (forced === "0" || forced?.toLowerCase() === "false") return "leave-running"
  // Only an interactive interrupt has someone to answer.
  if (opts.signal === "SIGINT" && opts.isTty === true) return "ask"
  return "leave-running"
}

/**
 * Ask the person at the terminal. Resolves to the default on timeout, EOF, or
 * anything that is not a clear yes — a shutdown must not block on an answer.
 *
 * The budget is deliberately shorter than `gracefulShutdown`'s force-exit timer:
 * a prompt that outlives the shutdown it belongs to is worse than no prompt.
 */
export function askKillAgents(count: number, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      resolve(false)
      return
    }
    process.stdout.write(`\n${count} agent(s) are still running. Stop them too? [y/N] `)
    let done = false
    const finish = (answer: boolean): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      process.stdin.off("data", onData)
      process.stdin.pause()
      process.stdout.write(answer ? "stopping agents\n" : "leaving agents running\n")
      resolve(answer)
    }
    const onData = (chunk: Buffer): void => finish(/^\s*y/i.test(chunk.toString("utf8")))
    const timer = setTimeout(() => finish(false), timeoutMs)
    timer.unref?.()
    process.stdin.resume()
    process.stdin.on("data", onData)
  })
}

/**
 * Stop the sidecar units of agents that should not outlive this process.
 *
 * Only reaches sidecars: a spawned child is already gone by the time this runs,
 * because closing its connection is what killed it.
 */
export async function applyShutdownDisposition(
  agentIds: readonly string[],
  opts: { signal: string; env?: NodeJS.ProcessEnv; isTty?: boolean },
  stopUnit: (agentId: string) => boolean,
): Promise<ShutdownDisposition> {
  if (agentIds.length === 0) return "leave-running"
  let decision = shutdownDisposition(opts)
  if (decision === "ask") {
    decision = (await askKillAgents(agentIds.length)) ? "kill-all" : "leave-running"
  }
  if (decision === "kill-all") {
    for (const id of agentIds) stopUnit(id)
  }
  return decision
}

/**
 * The whole agent side of a shutdown, in one call so the boot wiring stays a
 * single expression.
 *
 * Closes every live connection first — which for a spawned child *is* the kill,
 * and for a sidecar is only a disconnect — and then applies policy to whatever
 * survived that.
 */
export async function shutdownAgents(
  registry: { list(): string[]; close(agentId: string): Promise<void> },
  ctx: { sig: string },
  stopUnit: (agentId: string) => boolean,
): Promise<void> {
  const live = registry.list()
  await Promise.allSettled(live.map((id) => registry.close(id)))
  await applyShutdownDisposition(live, { signal: ctx.sig }, stopUnit)
}
