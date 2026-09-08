/**
 * agents-store.ts — the agent registry's on-disk snapshot.
 *
 * One file per deployment, holding every agent row. Written whole on every
 * mutation and replaced atomically, so a reader never sees half a snapshot and
 * a crash mid-write cannot corrupt the previous one.
 *
 * ─── Why a single file and not one per agent ─────────────────────────────────
 *
 * A directory of per-agent files has no atomic "set of agents" — a delete plus
 * a create is two syscalls, and a crash between them leaves a state that never
 * existed. write+rename of one file gives that for free, and the file is small
 * (tens of rows at most, no message history).
 *
 * ⚠️ Runtime fields are stripped before writing. `title`, and the enrichment
 * that http-agents adds per request (`pid`, `attached`, `busy`, `lastSeenAt`,
 * …), describe a live process. Persisting them would resurrect a claim about a
 * process that is gone — worse than losing them, because it reads as truth.
 */

import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { Agent } from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import { Agent as AgentSchema } from "@drive-coding/core/schemas/agent"
import { type } from "arktype"
import { ensureStateSubdir } from "../paths.js"

const log = createLogger("backend.agents.store")

/**
 * Where the snapshot lives: one file per deployment, named by port.
 *
 * dev/edge/main run side by side on this machine and the port is already what
 * tells them apart (4000/4001/4002 in the unit files). A shared file would have
 * each backend delete the others' agents on its first mutation.
 *
 * The env layer is consulted directly rather than only through the resolved
 * config, because callers that build deps by hand — every test that boots the
 * server — pass `{}` as config and would otherwise land in the real state dir
 * of a live deployment. Precedence still reads config-first, so a resolved
 * `agentsStoreFile` (which the env already fed) keeps winning.
 */
export function resolveAgentsStoreFile(
  config: { agentsStoreFile?: string; port?: number },
  env: NodeJS.ProcessEnv,
  fallbackPort: number,
): string {
  const explicit = config.agentsStoreFile ?? env.AGENTS_STORE_FILE
  if (explicit !== undefined && explicit !== "") return explicit
  return join(ensureStateSubdir("agents"), `${config.port ?? fallbackPort}.json`)
}

/** Bumped only on a breaking shape change; a mismatch drops the file, not the boot. */
export const AGENTS_STORE_VERSION = 1

type StoreFile = { version: number; agents: unknown[] }

/** Fields that describe a live process and must never outlive it. */
export function stripRuntimeFields(agent: Agent): Agent {
  const { title: _title, ...rest } = agent
  return rest as Agent
}

/**
 * readAgentStore — load the snapshot, dropping anything that no longer parses.
 *
 * Never throws. A missing file is the normal first-boot case; a corrupt one is
 * logged and treated as empty, because refusing to boot over a stale cache
 * would be a worse failure than starting with no agents.
 */
export function readAgentStore(file: string): Agent[] {
  let parsed: StoreFile
  try {
    parsed = JSON.parse(readFileSync(file, "utf8")) as StoreFile
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log.warn({ err, file }, "agents store unreadable — starting empty")
    }
    return []
  }
  if (parsed?.version !== AGENTS_STORE_VERSION || !Array.isArray(parsed.agents)) {
    log.warn({ file, version: parsed?.version }, "agents store version mismatch — ignored")
    return []
  }
  const rows: Agent[] = []
  for (const raw of parsed.agents) {
    const out = AgentSchema(raw)
    if (out instanceof type.errors) {
      log.warn({ file, problem: out.summary }, "agents store row rejected — dropped")
      continue
    }
    rows.push(out as Agent)
  }
  return rows
}

/**
 * writeAgentStore — replace the snapshot atomically (write temp, rename over).
 *
 * rename(2) is atomic within a filesystem, so a concurrent reader sees either
 * the old file or the new one. Never throws: losing the snapshot must not take
 * the request that triggered it down with it.
 */
export function writeAgentStore(file: string, agents: readonly Agent[]): void {
  const tmp = `${file}.${process.pid}.tmp`
  try {
    mkdirSync(dirname(file), { recursive: true })
    const body: StoreFile = {
      version: AGENTS_STORE_VERSION,
      agents: agents.map(stripRuntimeFields),
    }
    writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, "utf8")
    renameSync(tmp, file)
  } catch (err) {
    log.warn({ err, file }, "agents store write failed")
    try {
      unlinkSync(tmp)
    } catch {
      /* best effort — the temp file is not worth a second failure */
    }
  }
}
