import { configDefault } from "@drive-coding/core/config/specs"
import { createLogger } from "@drive-coding/core/log"
import type { ConnectionRegistry } from "../acp/connection-registry.js"
import type { PatchesBroadcaster } from "./patches-broadcaster.js"
import type { HostEntry } from "./registry.js"

const log = createLogger("backend.session-host.viewer-ttl")

/**
 * resolveHttpOwnerTtlMs — parses HTTP_OWNER_TTL_MS.
 *
 * 🔴 Pure + EXPORTED on purpose: the default path must be executable by a test
 * without any injected seam. Run-1's lesson (`Illegal invocation`) was a suite
 * of 30 green tests that all injected a mock and never once ran the default.
 *
 * Accepts only a finite, strictly-positive number. Anything else — missing,
 * blank, NaN, 0, negative, Infinity — falls back to configDefault("httpOwnerTtlMs").
 */
export function resolveHttpOwnerTtlMs(raw: string | undefined): number {
  const fallback = configDefault("httpOwnerTtlMs")
  if (raw === undefined) return fallback
  const trimmed = raw.trim()
  if (trimmed === "") return fallback
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return n
}

export function startViewerTtlSweep({
  map,
  connectionRegistry,
  _httpSweepMs,
  _httpOwnerTtlMs,
  env,
}: {
  map: ReadonlyMap<string, HostEntry>
  connectionRegistry: ConnectionRegistry
  _httpSweepMs?: number
  _httpOwnerTtlMs?: number
  env?: NodeJS.ProcessEnv
}): ReturnType<typeof setInterval> {
  const ttlMs = _httpOwnerTtlMs ?? resolveHttpOwnerTtlMs(env?.HTTP_OWNER_TTL_MS)
  const sweepMs = _httpSweepMs ?? 30_000
  const interval = setInterval(() => {
    const now = Date.now()
    for (const [agentId, entry] of map) {
      for (const row of connectionRegistry.listViewerRows(agentId)) {
        if (now - row.lastSeenAt <= ttlMs) continue
        log.info(
          { agentId, connectionId: row.connectionId, staleMs: now - row.lastSeenAt },
          "viewer connection stale — removing row (holder retained)",
        )
        if (row.stream !== undefined)
          entry.broadcaster.unsubscribe(
            row.stream as Parameters<PatchesBroadcaster["unsubscribe"]>[0],
          )
        connectionRegistry.removeConnection(agentId, row.connectionId)
      }
    }
  }, sweepMs)
  interval.unref() // don't prevent process exit
  return interval
}
