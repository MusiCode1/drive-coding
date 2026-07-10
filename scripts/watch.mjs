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
function line(s) {
  process.stdout.write(`${s}\n`)
  try {
    appendFileSync(LOG, `${s}\n`)
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

console.log(`\nwatchdog → ${HEALTH}   (Ctrl+C to stop, log → ${LOG})\n`)
console.log("  time      rtt     loop-max  loop-mean  BE-rss   heap     agents      status")
console.log("  --------  ------  --------  ---------  -------  -------  ----------  -------------------------")

async function tick() {
  const r = await poll()
  const t = new Date().toTimeString().slice(0, 8)

  if (!r.ok) {
    streak++
    line(`  ${t}   --      --        --         --       --       --          ⛔ NO RESPONSE (frozen/down)`)
    if (streak >= STALL_STREAK && !announced) {
      announced = true
      line(`\n  🔴 endpoint silent ~${streak}s — event-loop FROZEN or BE dead. THIS is the hang.`)
      line(`     (check BE log for the last 'slow hot-path op' before the silence)\n`)
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

  line(
    `  ${t}  ${pad(rtt, 4)}ms  ${pad(el.maxMs, 6)}ms  ${pad(el.meanMs, 7)}ms  ${pad(m.rssMB, 4)}MB  ${pad(m.heapUsedMB, 4)}MB  ${pad(ag.total, 2)} (${ag.busy} busy)   ${status}`,
  )
}

setInterval(() => void tick(), 1000)
void tick()
