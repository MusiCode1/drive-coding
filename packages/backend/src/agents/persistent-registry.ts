/**
 * persistent-registry.ts — the in-memory registry, mirrored to disk.
 *
 * A decorator, not a second implementation: createInMemoryAgentRegistry stays
 * the only place that knows how a row is stored, and this file only decides
 * *when* the snapshot is written and *which* rows come back at boot.
 *
 * ─── Adoption is deliberately opt-in ─────────────────────────────────────────
 *
 * 🔴 Reading a row back does NOT mean the agent is alive. Today every CLI dies
 * with the backend (`KillMode=control-group` in the unit file kills the whole
 * cgroup, and the child's stdio pipes die with the parent either way), so a
 * snapshot restored blindly would fill the agent list with rows whose process
 * is gone — a list that reads as truth and is not.
 *
 * Hence `adopt`: it receives the rows read from disk and returns the ones that
 * are genuinely re-attachable. The default is `adoptNone` — behaviour identical
 * to today, and the file is written but never trusted. The sidecar slice
 * replaces it with a probe over the socket directory, and that single swap is
 * what turns "the backend restarted" from "everything died" into "everything
 * reconnected".
 */

import type { Agent, AgentRegistry } from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import { readAgentStore, writeAgentStore } from "./agents-store.js"
import { createInMemoryAgentRegistry } from "./registry.js"

const log = createLogger("backend.agents.persist")

/** Which persisted rows may re-enter the live registry. Sync — boot is sync. */
export type AdoptFn = (rows: readonly Agent[]) => readonly Agent[]

/** Nothing survives the process. The honest default until agents outlive the BE. */
export const adoptNone: AdoptFn = () => []

export type PersistentAgentRegistry = AgentRegistry & {
  /** Resolves once every pending snapshot has hit the disk. Tests + shutdown. */
  flush(): Promise<void>
}

export function createPersistentAgentRegistry(opts: {
  file: string
  adopt?: AdoptFn
}): PersistentAgentRegistry {
  const adopt = opts.adopt ?? adoptNone
  const onDisk = readAgentStore(opts.file)
  const seed = adopt(onDisk)
  if (onDisk.length > 0) {
    log.info({ file: opts.file, found: onDisk.length, adopted: seed.length }, "agents store loaded")
  }

  // Coalescing: N mutations inside one tick produce one write, and a mutation
  // that lands *during* a write schedules the next one — so the last state
  // always reaches the disk without a write per keystroke.
  let queued = false
  let chain: Promise<void> = Promise.resolve()

  const inner = createInMemoryAgentRegistry({
    seed,
    onChange: () => {
      if (queued) return
      queued = true
      chain = chain.then(async () => {
        queued = false
        writeAgentStore(opts.file, await inner.list())
      })
    },
  })

  // The seed is not a mutation, so onChange never fires for it. Write once at
  // boot anyway: without this, adopting a subset would leave the dropped rows
  // on disk until the first unrelated mutation.
  if (onDisk.length !== seed.length) writeAgentStore(opts.file, seed)

  return {
    ...inner,
    async flush(): Promise<void> {
      // `chain` is re-read on every await: draining it can release a mutation
      // that queued while the previous write was still in flight.
      while (queued) await chain
      await chain
    },
  }
}
