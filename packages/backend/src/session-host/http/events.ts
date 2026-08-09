/**
 * events.ts — GET /api/agents/:id/events (S4 C2).
 *
 * SSE endpoint: streams SessionState snapshot (frame-zero) then patches.
 *
 * Protocol:
 *   event: snapshot\ndata: <JSON state>\n\n
 *   event: patch\ndata: <JSON patch>\n\n
 *   ...
 *
 * Design:
 *   - register-then-snapshot: subscribe to broadcaster BEFORE reading state
 *     (prevents race where a patch arrives between snapshot read and subscribe)
 *   - 404 if connection not found (registry.getOrCreateHost returns undefined)
 *   - Client disconnect: broadcaster.unsubscribe(stream) on ReadableStream cancel
 *
 * ─── slice session-host-http C2 (TDD) ───
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

    // Look up or create host + broadcaster
    const result = await registry.getOrCreateHost(agentId)
    if (!result) {
      return c.json({ error: "Agent connection not found" }, 404)
    }
    const { host, broadcaster } = result

    // Set SSE headers
    c.header("Content-Type", "text/event-stream")
    c.header("Cache-Control", "no-cache")
    c.header("Connection", "keep-alive")

    return stream(c, async (s) => {
      // ── register-then-snapshot ────────────────────────────────────────────
      // Subscribe FIRST so no patches are missed between snapshot + subscribe
      const patchStream = broadcaster.subscribe()

      // Then read snapshot and send as frame-zero
      const snapshot = host.state
      await s.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`)

      // Stream patches from broadcaster
      const reader = patchStream.getReader()
      try {
        while (true) {
          const { done, value: patch } = await reader.read()
          if (done) break
          await s.write(`event: patch\ndata: ${JSON.stringify(patch)}\n\n`)
        }
      } catch {
        // Client disconnected or stream errored — clean up below
      } finally {
        reader.releaseLock()
        broadcaster.unsubscribe(patchStream)
      }
    })
  })
}
