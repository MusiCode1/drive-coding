/**
 * http-health.ts — GET /api/diag. In-BE health snapshot for the watchdog.
 *
 * Exposes: event-loop delay histogram (the early hang signal — maxMs climbs before
 * a freeze), process memory, and per-agent runtime (pid/busy/attached/last-activity).
 *
 * NOTE (the paradox): this endpoint is served FROM the BE loop, so it cannot report a
 * FULL freeze — if the loop is stuck, this handler never runs and the fetch times out.
 * That timeout IS the signal the external watchdog uses. This endpoint's job is the
 * rich data + the EARLY warning (rising eventLoop.maxMs) while the loop still breathes.
 *
 * monitorEventLoopDelay works on both Node and Bun (verified: a 300ms block → max≈306ms).
 */

import { type IntervalHistogram, monitorEventLoopDelay } from "node:perf_hooks"
import os from "node:os"
import { deriveMachineStats, type AgentRegistry } from "@drive-coding/core"
import type { Hono } from "hono"

// Single process-wide histogram, enabled once. reset() per poll = rolling window.
let eld: IntervalHistogram | undefined
function ensureEld(): IntervalHistogram {
  if (!eld) {
    eld = monitorEventLoopDelay({ resolution: 20 })
    eld.enable()
  }
  return eld
}

const nsToMs = (ns: number): number => Math.round((ns / 1e6) * 10) / 10
const bToMb = (b: number): number => Math.round(b / 1024 / 1024)

interface RuntimeInfo {
  pid: number | null
  attached: boolean
  busy: boolean
  lastMessageAt: number | null
}

export function registerHealthHttp(
  app: Hono,
  deps: {
    registry: AgentRegistry
    connectionRegistry: { getRuntimeInfo(id: string): RuntimeInfo | null }
  },
): void {
  const h = ensureEld()
  const startedAt = Date.now()

  app.get("/api/diag", async (c) => {
    const now = Date.now()
    const mem = process.memoryUsage()

    const eventLoop = {
      meanMs: nsToMs(h.mean),
      maxMs: nsToMs(h.max),
      p99Ms: nsToMs(h.percentile(99)),
      stddevMs: nsToMs(h.stddev),
    }
    h.reset() // rolling window: next poll reports lag since this moment

    const machine = deriveMachineStats({
      totalMemBytes: os.totalmem(),
      freeMemBytes: os.freemem(),
      loadAvg1: os.loadavg()[0] ?? 0, // ב-Windows loadavg() מחזיר [0,0,0] — memPct עדיין תקף
      cpuCount: os.cpus().length,
    })

    const all = await deps.registry.list()
    const list = all.map((a) => {
      const rt = deps.connectionRegistry.getRuntimeInfo(a.id)
      return {
        agentId: a.id,
        cliKind: a.cliKind,
        pid: rt?.pid ?? null,
        busy: rt?.busy ?? false,
        attached: rt?.attached ?? false,
        lastMessageAgoMs: rt?.lastMessageAt != null ? now - rt.lastMessageAt : null,
      }
    })

    return c.json({
      ts: now,
      uptimeMs: now - startedAt,
      eventLoop,
      memory: {
        rssMB: bToMb(mem.rss),
        heapUsedMB: bToMb(mem.heapUsed),
        heapTotalMB: bToMb(mem.heapTotal),
        externalMB: bToMb(mem.external),
      },
      machine,
      agents: {
        total: list.length,
        busy: list.filter((x) => x.busy).length,
        list,
      },
    })
  })
}
