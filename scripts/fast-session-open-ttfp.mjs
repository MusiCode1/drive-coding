#!/usr/bin/env node
/**
 * TTFP — slice fast-session-open-1 C6.
 * Measures time to first SSE byte (http) or first WS frame after meta connect + parallel /history.
 *
 * Usage:
 *   node scripts/fast-session-open-ttfp.mjs --be http://127.0.0.1:4012 --agent <id> [--runs 3]
 */
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

const require = createRequire(
  join(dirname(fileURLToPath(import.meta.url)), "../packages/backend/package.json"),
)
const { WebSocket } = require("ws")

const { values } = parseArgs({
  options: {
    be: { type: "string" },
    agent: { type: "string" },
    runs: { type: "string", default: "3" },
    maxBytes: { type: "string", default: "262144" },
    phase: { type: "string", default: "after" },
    mode: { type: "string", default: "meta" },
  },
})

if (!values.be || !values.agent) {
  console.error(
    "Usage: node scripts/fast-session-open-ttfp.mjs --be <origin> --agent <id> [--runs 3] [--phase before|after]",
  )
  process.exit(2)
}

const runs = Number(values.runs)
const base = values.be.replace(/\/$/, "")
const agent = values.agent
const maxBytes = values.maxBytes

async function measureHttpOnce() {
  const t0 = performance.now()
  const eventsUrl =
    values.mode === "full"
      ? `${base}/api/agents/${agent}/events`
      : `${base}/api/agents/${agent}/events?snapshot=meta`
  const historyUrl = `${base}/api/agents/${agent}/history?tail=1&maxBytes=${maxBytes}`
  const fetches = [fetch(eventsUrl, { headers: { Accept: "text/event-stream" } })]
  if (values.mode !== "full") {
    fetches.push(fetch(historyUrl, { headers: { "Accept-Encoding": "gzip, br, zstd" } }))
  }
  const results = await Promise.all(fetches)
  const eventsRes = results[0]
  const historyRes = values.mode !== "full" ? results[1] : null
  if (!eventsRes.ok || (historyRes && !historyRes.ok)) {
    throw new Error(
      `http open failed events=${eventsRes.status} history=${historyRes?.status ?? "n/a"}`,
    )
  }
  const reader = eventsRes.body?.getReader()
  if (reader) {
    await reader.read()
    reader.releaseLock()
  }
  const t1 = performance.now()
  let historyDetail = null
  if (historyRes) {
    const enc = historyRes.headers.get("content-encoding")
    const historyJson = await historyRes.json()
    const rawBytes = Number(historyRes.headers.get("content-length") ?? 0)
    historyDetail = {
      historyBytes: rawBytes,
      historyEncoding: enc,
      historyUpdates: historyJson.updates?.length ?? 0,
    }
  }
  return {
    ms: t1 - t0,
    ...historyDetail,
  }
}

function measureWsOnce() {
  return new Promise((resolve, reject) => {
    const t0 = performance.now()
    const q = values.mode === "full" ? "" : `?snapshot=meta&tail=1&maxBytes=${maxBytes}`
    const url = `${base.replace(/^http/, "ws")}/ws/session/${agent}${q}`
    const ws = new WebSocket(url)
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error("ws timeout 30s"))
    }, 30_000)
    ws.once("message", () => {
      clearTimeout(timer)
      const t1 = performance.now()
      ws.close()
      resolve({ ms: t1 - t0 })
    })
    ws.once("error", (e) => {
      clearTimeout(timer)
      reject(e)
    })
  })
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

async function runTransport(name, fn) {
  const samples = []
  for (let i = 0; i < runs; i++) {
    samples.push((await fn()).ms)
  }
  return { transport: name, medianMs: Math.round(median(samples)), samples }
}

const httpDetail = await measureHttpOnce()
const http = await runTransport("http", measureHttpOnce)
const ws = await runTransport("ws", measureWsOnce)

console.log(
  JSON.stringify(
    {
      phase: values.phase,
      agent,
      be: base,
      sessionSizeNote:
        "preview-loaded cursor session ~11.2MB full /history (DoD #7: no ≥20MB fixture on host)",
      http,
      ws,
      historySample: {
        encoding: httpDetail.historyEncoding,
        bytes: httpDetail.historyBytes,
        updates: httpDetail.historyUpdates,
      },
    },
    null,
    2,
  ),
)
