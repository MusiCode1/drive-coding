/**
 * events.ts — GET /api/agents/:id/events (S4 C2).
 *
 * SSE endpoint: streams SessionState snapshot (frame-zero) then patches.
 *
 * Protocol:
 *   event: snapshot\nid: <epoch>\ndata: <JSON state>\n\n
 *   event: patch\ndata: <JSON patch>\n\n
 *   ...
 *   event: taken-over\nid: <new-epoch>\ndata: {}\n\n
 *
 * Design:
 *   - register-then-snapshot: subscribe to broadcaster BEFORE reading state
 *     (prevents race where a patch arrives between snapshot read and subscribe)
 *   - 404 if connection not found (registry.getOrCreateHost returns undefined)
 *   - Client disconnect: broadcaster.unsubscribe(stream) on ReadableStream cancel
 *   - Epoch guard: if ?epoch= query param is present and LESS THAN current epoch,
 *     returns 409 immediately (BEFORE getOrCreateHost) so a stale reconnect can't
 *     evict the current owner.
 *   - taken-over: when broadcaster ends (host disposed by a new owner), sends
 *     taken-over event so the client stops reconnecting.
 *
 * ─── slice session-host-http C2 (TDD) ───
 * ─── slice ownership-handoff C3 ───
 */

import type { Hono } from "hono"
import { stream } from "hono/streaming"
import type { AgentSessionRegistry } from "../registry.js"

/**
 * registerEventsRoute — registers GET /api/agents/:id/events on the Hono app.
 */
export function registerEventsRoute(app: Hono, registry: AgentSessionRegistry): void {
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
    if (!result) {
      return c.json({ error: "Agent connection not found" }, 404)
    }
    const { host, broadcaster } = result

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

      // slice liveness C1: keepalive comment keeps the connection alive through
      // proxies. NO touchOwner here — the server-side keepalive timer was a dead
      // liveness signal: hono's stream write() never rejects (it swallows errors),
      // so the old .catch was dead code and the owner never expired on disconnect.
      // The HTTP owner's liveness now comes from the FE presence poll
      // (POST …/presence → touchOwner), the only non-fakeable signal.
      // /state intentionally does NOT touch: it's a read-only polling endpoint and
      // touching it would allow a dead frontend that only polls state to hold ownership.
      const KEEPALIVE_INTERVAL_MS = 30_000
      const keepaliveTimer = setInterval(() => {
        // SSE comment — keeps connection alive through proxies, no-op for clients
        void s.write(": keepalive\n\n")
      }, KEEPALIVE_INTERVAL_MS)

      // Then read snapshot and send as frame-zero with epoch as SSE id
      const snapshot = host.state
      await s.write(
        `event: snapshot\nid: ${currentEpoch}\ndata: ${JSON.stringify(snapshot)}\n\n`,
      )

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
        clearInterval(keepaliveTimer)
        reader.releaseLock()
        broadcaster.unsubscribe(patchStream)
        void streamEndedByTakeover // used above — suppress unused warning
      }
    })
  })
}
