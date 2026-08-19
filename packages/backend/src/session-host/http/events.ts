/**
 * events.ts — GET /api/agents/:id/events (S4 C2).
 *
 * SSE endpoint: streams SessionState snapshot (frame-zero) then patches.
 *
 * Protocol:
 *   event: snapshot\nid: <epoch>\ndata: <JSON state>\n\n
 *   event: patch\ndata: <JSON patch>\n\n
 *   event: stream-alive\ndata: <_drive/streamAlive JSON-RPC notification>\n\n
 *   ...
 *   event: taken-over\nid: <new-epoch>\ndata: {}\n\n
 *
 * Design:
 *   - register-then-snapshot: subscribe to broadcaster BEFORE reading state
 *     (prevents race where a patch arrives between snapshot read and subscribe)
 *   - 404 if connection not found / dead / WS-owned (registry.getOrCreateHost →
 *     {ok:false, reason}), or 503 if the reason is "evict-timeout" (transient —
 *     slice host-result-reason C1)
 *   - Client disconnect: broadcaster.unsubscribe(stream) on ReadableStream cancel
 *   - Epoch guard: if ?epoch= query param is present and LESS THAN current epoch,
 *     returns 409 immediately (BEFORE getOrCreateHost) so a stale reconnect can't
 *     evict the current owner.
 *   - taken-over: when broadcaster ends (host disposed by a new owner), sends
 *     taken-over event so the client stops reconnecting.
 *
 * ─── slice session-host-http C2 (TDD) ───
 * ─── slice ownership-handoff C3 ───
 * ─── slice host-result-reason C1 (503 on evict-timeout) + C2 (keepalive timer seam) ───
 * ─── slice sse-liveness Commit 2: keepalive frame becomes a visible, named SSE
 *      event carrying a real _drive/streamAlive JSON-RPC notification — the old
 *      `: keepalive` SSE *comment* line is invisible to SSEReader's parser by
 *      design (only `event:`/`data:` lines become frames), so a client could
 *      never use it as a liveness signal despite the server emitting it every
 *      30s (see stream-alive.ts for the full "why"). ───
 */

import {
  STREAM_ALIVE_EVENT,
  STREAM_ALIVE_INTERVAL_MS,
  STREAM_ALIVE_METHOD,
} from "@drive-coding/core/session"
import type { Hono } from "hono"
import { stream } from "hono/streaming"
import type { AgentSessionRegistry } from "../registry.js"

/**
 * slice host-result-reason C2: the keepalive `setInterval` was hardcoded inside
 * `stream()`'s callback, with no way to test that it fires (or that it's
 * cleared) without waiting real wall-clock time. Same seam pattern as
 * `SSEReader`'s `_fetch`/`_sleep`/`_now` (packages/frontend/src/lib/session/sse-reader.ts):
 * default = the real global, so production is byte-for-byte unchanged.
 */
export type RegisterEventsRouteOptions = {
  /** @internal For testing — override the keepalive timer's scheduler. */
  _setInterval?: typeof setInterval
  /** @internal For testing — override the keepalive timer's cancel. */
  _clearInterval?: typeof clearInterval
}

/**
 * registerEventsRoute — registers GET /api/agents/:id/events on the Hono app.
 */
export function registerEventsRoute(
  app: Hono,
  registry: AgentSessionRegistry,
  opts: RegisterEventsRouteOptions = {},
): void {
  const doSetInterval = opts._setInterval ?? setInterval
  const doClearInterval = opts._clearInterval ?? clearInterval
  app.get("/api/agents/:id/events", async (c) => {
    const agentId = c.req.param("id")

    // ── slice ownership-handoff C3: epoch guard ──────────────────────────────
    // Check the client's epoch BEFORE getOrCreateHost — a stale client
    // reconnecting must not evict the current owner by triggering lazy creation.
    const epochParam = c.req.query("epoch")
    if (epochParam !== undefined) {
      const clientEpoch = Number(epochParam)
      const serverEpoch = registry.getEpoch(agentId)
      if (!Number.isNaN(clientEpoch) && clientEpoch < serverEpoch) {
        return c.json({ error: "taken-over", epoch: serverEpoch }, 409)
      }
    }

    // Look up or create host + broadcaster
    const result = await registry.getOrCreateHost(agentId)
    if (!result.ok) {
      // slice host-result-reason C1: three of the four failure reasons are final
      // (not-found / conn-dead / ws-owned) → 404, unchanged. Only evict-timeout
      // is transient (a stuck WS tab, not a dead agent) → 503.
      const status = result.reason === "evict-timeout" ? 503 : 404
      return c.json({ error: "Agent connection not found" }, status)
    }
    const { host, broadcaster } = result.entry

    // Current epoch at connection time — used in snapshot frame-zero id
    const currentEpoch = registry.getEpoch(agentId)

    // Set SSE headers
    c.header("Content-Type", "text/event-stream")
    c.header("Cache-Control", "no-cache")
    c.header("Connection", "keep-alive")

    return stream(c, async (s) => {
      // ── register-then-snapshot ────────────────────────────────────────────
      // Subscribe FIRST so no patches are missed between snapshot + subscribe
      const patchStream = broadcaster.subscribe()

      // slice liveness C1: keepalive keeps the connection alive through proxies.
      // NO touchOwner here — the server-side keepalive timer was a dead liveness
      // signal: hono's stream write() never rejects (it swallows errors), so the
      // old .catch was dead code and the owner never expired on disconnect. The
      // HTTP owner's liveness now comes from the FE presence poll (POST …/presence
      // → touchOwner), the only non-fakeable signal. /state intentionally does NOT
      // touch: it's a read-only polling endpoint and touching it would allow a dead
      // frontend that only polls state to hold ownership.
      //
      // slice sse-liveness Commit 2: the payload is now a NAMED SSE event carrying
      // a real _drive/streamAlive JSON-RPC notification (not `{}` — a named event
      // is wire framing; the envelope is what makes it an actual protocol message,
      // and it's what survives unchanged to WS/v2). No `id:` — an `id` here would
      // make a future `Last-Event-ID` reconnect skip patches that were never
      // actually received (id=version is reserved for `patch`/`snapshot` frames).
      const keepaliveTimer = doSetInterval(() => {
        void s.write(
          `event: ${STREAM_ALIVE_EVENT}\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: STREAM_ALIVE_METHOD, params: {} })}\n\n`,
        )
      }, STREAM_ALIVE_INTERVAL_MS)

      // Then read snapshot and send as frame-zero with epoch as SSE id
      const snapshot = host.state
      await s.write(`event: snapshot\nid: ${currentEpoch}\ndata: ${JSON.stringify(snapshot)}\n\n`)

      // Stream patches from broadcaster
      const reader = patchStream.getReader()
      let streamEndedByTakeover = false
      try {
        while (true) {
          const { done, value: patch } = await reader.read()
          if (done) {
            // Broadcaster ended — the host was disposed (eviction or expiry).
            // If a new owner exists (epoch advanced), signal taken-over.
            const newEpoch = registry.getEpoch(agentId)
            if (newEpoch > currentEpoch) {
              streamEndedByTakeover = true
              await s.write(`event: taken-over\nid: ${newEpoch}\ndata: {}\n\n`)
            }
            break
          }
          await s.write(`event: patch\ndata: ${JSON.stringify(patch)}\n\n`)
        }
      } catch {
        // Client disconnected or stream errored — clean up below
      } finally {
        doClearInterval(keepaliveTimer)
        reader.releaseLock()
        broadcaster.unsubscribe(patchStream)
        void streamEndedByTakeover // used above — suppress unused warning
      }
    })
  })
}
