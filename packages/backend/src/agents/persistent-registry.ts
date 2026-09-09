/**
 * persistent-registry.ts — the in-memory registry, mirrored to disk.
 *
 * A decorator, not a second implementation: createInMemoryAgentRegistry stays
 * the only place that knows how a row is stored, and this file only decides
 * *when* the snapshot is written and *which* rows come back at boot.
 *
 * ─── Loading is two-phase, and that is not an accident ───────────────────────
 *
 * 🔴 Reading a row back does NOT mean the agent is alive, and finding out costs
 * a round trip: the only reliable test is whether its socket answers a ping.
 * That is asynchronous, while building the boot dependencies is not — so the
 * two are separated rather than forced together.
 *
 *   construction → `pendingRows()`   rows on disk, none of them live yet
 *   boot         → `restore(rows)`   the subset that answered, now live
 *
 * Until `restore` is called the registry is empty and the file is untouched.
 * A backend that never calls it therefore behaves exactly as it did before any
 * of this existed — which is the right failure mode, because the alternative is
 * an agent list full of processes that are gone.
 *
 * `restore` also rewrites the snapshot to exactly what it was given, so rows
 * that did not come back stop being offered on the next boot.
 */

import type { Agent, AgentRegistry } from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import { readAgentStore, writeAgentStore } from "./agents-store.js"
import { createInMemoryAgentRegistry } from "./registry.js"

const log = createLogger("backend.agents.persist")

export type PersistentAgentRegistry = AgentRegistry & {
  /** Rows found on disk at construction. None of them are live yet. */
  pendingRows(): readonly Agent[]
  /**
   * Make `live` rows live and rewrite the snapshot to `live` + `retain`.
   *
   * `retain` is for rows we could not confirm but must not lose — a socket that
   * exists and did not answer in time. They stay on disk for the next boot
   * without being presented as running agents.
   */
  restore(live: readonly Agent[], retain?: readonly Agent[]): Promise<void>
  /** Resolves once every pending snapshot has hit the disk. Tests + shutdown. */
  flush(): Promise<void>
}

export function createPersistentAgentRegistry(opts: { file: string }): PersistentAgentRegistry {
  const onDisk = readAgentStore(opts.file)
  if (onDisk.length > 0) {
    log.info({ file: opts.file, found: onDisk.length }, "agents store loaded — awaiting restore")
  }

  // Coalescing: N mutations inside one tick produce one write, and a mutation
  // that lands *during* a write schedules the next one — so the last state
  // always reaches the disk without a write per keystroke.
  let queued = false
  let chain: Promise<void> = Promise.resolve()

  const onChange = (): void => {
    if (queued) return
    queued = true
    chain = chain.then(async () => {
      queued = false
      writeAgentStore(opts.file, await inner.list())
    })
  }

  // Replaced wholesale by `restore`, because a restored row must keep its own
  // id, createdAt and status — none of which `create()` would preserve. Hence
  // the explicit delegation below rather than a spread: the spread would
  // capture the methods of the registry that existed at construction time.
  let inner = createInMemoryAgentRegistry({ onChange })

  return {
    create: (input) => inner.create(input),
    get: (id) => inner.get(id),
    list: () => inner.list(),
    update: (id, patch) => inner.update(id, patch),
    delete: (id) => inner.delete(id),

    pendingRows(): readonly Agent[] {
      return onDisk
    },

    async restore(live: readonly Agent[], retain: readonly Agent[] = []): Promise<void> {
      inner = createInMemoryAgentRegistry({ seed: live, onChange })
      // Rewrite to live + retained. Rows in neither list are genuinely gone —
      // their socket was not in the directory — and must stop being offered.
      writeAgentStore(opts.file, [...(await inner.list()), ...retain])
      log.info(
        { live: live.length, retained: retain.length, found: onDisk.length },
        "agents restored",
      )
    },

    async flush(): Promise<void> {
      // `chain` is re-read on every await: draining it can release a mutation
      // that queued while the previous write was still in flight.
      while (queued) await chain
      await chain
    },
  }
}
