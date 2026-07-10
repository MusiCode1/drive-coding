#!/usr/bin/env node
/**
 * watch.mjs — EXTERNAL watchdog that polls GET /api/diag every second.
 *
 * Runs OUTSIDE the BE loop, so it catches a FULL freeze (the /api/diag fetch times
 * out → the loop is dead). While the loop still breathes, the endpoint returns rich
 * data: event-loop lag histogram, memory, per-agent runtime. A rising eventLoop.maxMs
 * is the EARLY "starting to hang" signal — before the freeze.
 *
 * Two layers, complementary:
 *   - here (external): liveness (timeout = freeze) + lag trend.
 *   - BE log (HOTPATH_SLOW_MS): WHICH op stalled, e.g. "stringify 800ms bytes=10MB".
 *
 *   BE_PORT=4001 bun scripts/watch.mjs
 */

import { appendFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const WT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const PORT = process.env.BE_PORT ?? "4001"
const HEALTH = `http://localhost:${PORT}/api/diag`
const LOG = resolve(WT, ".tmp/watch.log")

const TIMEOUT_MS = 3000 // no answer within this = loop frozen (or BE down)
const LAG_WARN_MS = 100 // eventLoop.maxMs above this = degraded
const LAG_ALERT_MS = 500 // above this = serious stall
const RSS_WARN_MB = 1200
const STALL_STREAK = 3

const pad = (v, n) => String(v).padStart(n)
// stdout ALWAYS (live table for interactive watching).
function out(s) {
  process.stdout.write(`${s}\n`)
}
// stdout + persist to .tmp/watch.log — ONLY for anomalies (signal-only log,
// not a per-second heartbeat; keeps the file small + every line meaningful).
// A date prefix is added since the row time is HH:MM:SS only.
function log(s) {
  out(s)
  try {
    appendFileSync(LOG, `${new Date().toISOString().slice(0, 10)} ${s.replace(/^\n/, "")}\n`)
  } catch {}
}

async function poll() {
  const t0 = performance.now()
  const ctrl = new AbortController()
  const to = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(HEALTH, { signal: ctrl.signal })
    clearTimeout(to)
    const h = await res.json()
    return { ok: true, rtt: Math.round(performance.now() - t0), h }
  } catch {
    clearTimeout(to)
    return { ok: false }
  }
}

let streak = 0
let announced = false

console.log(`\nwatchdog → ${HEALTH}   (Ctrl+C to stop · anomaly-only log → ${LOG})\n`)
console.log("  time      rtt     loop-max  loop-mean  BE-rss   heap     agents      status")
console.log("  --------  ------  --------  ---------  -------  -------  ----------  -------------------------")

async function tick() {
  const r = await poll()
  const t = new Date().toTimeString().slice(0, 8)

  if (!r.ok) {
    streak++
    log(`  ${t}   --      --        --         --       --       --          ⛔ NO RESPONSE (frozen/down)`)
    if (streak >= STALL_STREAK && !announced) {
      announced = true
      log(`\n  🔴 endpoint silent ~${streak}s — event-loop FROZEN or BE dead. THIS is the hang.`)
      log(`     (check BE log for the last 'slow hot-path op' before the silence)\n`)
    }
    return
  }

  streak = 0
  announced = false
  const { rtt, h } = r
  const el = h.eventLoop
  const m = h.memory
  const ag = h.agents

  let status = "ok"
  if (el.maxMs >= LAG_ALERT_MS) status = `⛔ LOOP STALL (max=${el.maxMs}ms)`
  else if (el.maxMs >= LAG_WARN_MS) status = `⚠️  lag climbing (max=${el.maxMs}ms)`
  if (m.rssMB >= RSS_WARN_MB) status += ` ⚠️ RSS ${m.rssMB}MB`

  const row = `  ${t}  ${pad(rtt, 4)}ms  ${pad(el.maxMs, 6)}ms  ${pad(el.meanMs, 7)}ms  ${pad(m.rssMB, 4)}MB  ${pad(m.heapUsedMB, 4)}MB  ${pad(ag.total, 2)} (${ag.busy} busy)   ${status}`
  // stdout always; persist to the log ONLY when there's a problem (signal-only).
  if (status === "ok") out(row)
  else log(row)
}

setInterval(() => void tick(), 1000)
void tick()
