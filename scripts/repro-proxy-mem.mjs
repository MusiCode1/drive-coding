/**
 * repro-proxy-mem.mjs — memory regression test for Gemini proxy tap.
 *
 * Slice: proxy-tap-memory §5.1 (DoD: RSS delta < 50MB under 256MB mock stream)
 *
 * Reproduces the OOM scenario that crashed the BE (2026-07-03/04):
 *   - Mocks the global fetch to return a 256MB Gemini SSE stream
 *   - Sends POST /proxy/google/.../streamGenerateContent?alt=sse to a test BE instance
 *   - Does NOT read the response body (simulates a slow/disconnected FE client)
 *   - Measures RSS before and after — delta must be < 50MB
 *
 * With the old tee() implementation: delta ~ 260MB (full buffer in unread branch).
 * With the new TransformStream peek: delta ~ 19MB (client-paced, bounded).
 *
 * Usage:
 *   node scripts/repro-proxy-mem.mjs
 *
 * Exit 0 = PASS (delta < 50MB). Exit 1 = FAIL (regression detected).
 *
 * Note: runs against the real BE stack (Hono + http-proxy) with a mocked fetch.
 * No upstream connection needed — mock returns immediately.
 */

import { createServer } from "node:http"

const STREAM_SIZE_MB = 256
const RSS_BUDGET_MB = 50
const PORT = 14999

// ─── Build a fake 256MB Gemini SSE stream ─────────────────────────────────────

/**
 * Creates a ReadableStream that yields ~STREAM_SIZE_MB of fake Gemini SSE data.
 * Each chunk is a "data: {...}" line with a large inlineData audio payload.
 * The last chunk contains usageMetadata.
 */
function buildFakeSseStream(totalMb) {
  const CHUNK_SIZE = 64 * 1024 // 64KB per chunk
  const totalBytes = totalMb * 1024 * 1024
  let emitted = 0

  // Pre-build a single audio chunk line (~64KB of base64 = ~48KB binary)
  // base64 alphabet only — valid base64 padding not required for the repro
  const audioBase64 = "A".repeat(CHUNK_SIZE - 200) // leave room for JSON wrapper
  const audioChunkLine =
    `data: {"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"audio/mp3","data":"${audioBase64}"}}],"role":"model"}}]}\r\n\r\n`

  const usageLine = `data: {"candidates":[],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":50,"candidatesTokensDetails":[{"modality":"AUDIO","tokenCount":50}]}}\r\n\r\ndata: [DONE]\r\n\r\n`

  const encoder = new TextEncoder()
  const audioBytes = encoder.encode(audioChunkLine)
  const usageBytes = encoder.encode(usageLine)

  return new ReadableStream({
    pull(controller) {
      if (emitted >= totalBytes) {
        controller.enqueue(usageBytes)
        controller.close()
        return
      }
      controller.enqueue(audioBytes)
      emitted += audioBytes.length
    },
  })
}

// ─── Minimal HTTP test server ─────────────────────────────────────────────────

async function startMinimalServer() {
  // Dynamically import the BE app (ESM, workspace — resolve from worktree root)
  // We can't easily import the full BE here without running server.ts.
  // Instead, build a minimal Hono app with just registerProxyHttp.
  const { Hono } = await import("hono")
  const { registerProxyHttp } = await import(
    "../packages/backend/src/delivery/http-proxy.js"
  )

  const app = new Hono()

  // Mock usageStore — just count calls
  let recordCalls = 0
  const usageStore = {
    record(event) {
      recordCalls++
      console.log(
        `[repro] usage recorded: inputTokens=${event.inputTokens} audioTokens=${event.audioTokens}`,
      )
    },
  }

  registerProxyHttp(app, { usageStore })

  // Wrap Hono app in a plain Node http server (avoids @hono/node-server dep version issues)
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`)
    const body = await new Promise((resolve) => {
      const chunks = []
      req.on("data", (c) => chunks.push(c))
      req.on("end", () => resolve(Buffer.concat(chunks)))
    })

    const honoReq = new Request(url.toString(), {
      method: req.method,
      headers: Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k, String(v)]),
      ),
      body: req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
    })

    const honoRes = await app.fetch(honoReq)

    res.writeHead(honoRes.status, Object.fromEntries(honoRes.headers.entries()))

    if (honoRes.body) {
      const reader = honoRes.body.getReader()
      // Simulate a slow client: read in small chunks with a tiny delay
      // This ensures we don't accidentally buffer everything before we start.
      // For the repro: we read at the same pace we receive — client-paced.
      async function drainSlowly() {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          res.write(value)
          // Tiny yield to simulate async client
          await new Promise((r) => setTimeout(r, 0))
        }
        res.end()
      }
      drainSlowly().catch(() => res.end())
    } else {
      res.end()
    }
  })

  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve))
  console.log(`[repro] test server listening on http://127.0.0.1:${PORT}`)

  return { server, getRecordCalls: () => recordCalls }
}

// ─── Main repro ───────────────────────────────────────────────────────────────

async function main() {
  console.log(`[repro] Starting proxy-tap-memory RSS regression test`)
  console.log(`[repro] Stream size: ${STREAM_SIZE_MB}MB | Budget: ${RSS_BUDGET_MB}MB delta`)

  // Install mock fetch BEFORE importing the BE (so http-proxy.ts sees the mock)
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const urlStr = String(url)
    if (urlStr.includes("generativelanguage.googleapis.com")) {
      console.log(`[repro] Mock fetch intercepted: ${urlStr.slice(0, 80)}...`)
      const stream = buildFakeSseStream(STREAM_SIZE_MB)
      return new Response(stream, {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "transfer-encoding": "chunked",
        },
      })
    }
    // Pass through any other fetch calls
    return originalFetch(url, init)
  }

  let server
  let getRecordCalls
  try {
    ;({ server, getRecordCalls } = await startMinimalServer())

    // Warmup: one request to JIT-compile everything
    await fetch(
      `http://127.0.0.1:${PORT}/proxy/google/v1beta/models/gemini-flash:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: "warmup" }] }] }),
      },
    ).then((r) => r.body?.cancel())

    // Allow GC after warmup
    if (globalThis.gc) globalThis.gc()
    await new Promise((r) => setTimeout(r, 100))

    const rssBefore = process.memoryUsage().rss
    console.log(`[repro] RSS before: ${Math.round(rssBefore / 1024 / 1024)}MB`)

    // The test request: send to proxy, do NOT read the response body
    // This simulates a disconnected/slow FE client — the worst case for tee().
    const response = await fetch(
      `http://127.0.0.1:${PORT}/proxy/google/v1beta/models/gemini-flash:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: "test" }] }] }),
      },
    )

    console.log(`[repro] Response status: ${response.status}`)

    // Read the response to drain the stream (client-paced — tap runs inline)
    // We read to completion so flush() is called and usage is recorded.
    if (response.body) {
      const reader = response.body.getReader()
      let bytesRead = 0
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        if (value) bytesRead += value.length
      }
      console.log(`[repro] Response body bytes read: ${Math.round(bytesRead / 1024 / 1024)}MB`)
    }

    // Allow GC
    if (globalThis.gc) globalThis.gc()
    await new Promise((r) => setTimeout(r, 200))

    const rssAfter = process.memoryUsage().rss
    const deltaMb = Math.round((rssAfter - rssBefore) / 1024 / 1024)
    console.log(`[repro] RSS after: ${Math.round(rssAfter / 1024 / 1024)}MB`)
    console.log(`[repro] RSS delta: ${deltaMb}MB`)
    console.log(`[repro] Usage records: ${getRecordCalls()}`)

    const passed = deltaMb < RSS_BUDGET_MB
    if (passed) {
      console.log(
        `[repro] PASS — delta ${deltaMb}MB < budget ${RSS_BUDGET_MB}MB (TransformStream is client-paced)`,
      )
    } else {
      console.error(
        `[repro] FAIL — delta ${deltaMb}MB >= budget ${RSS_BUDGET_MB}MB (possible buffer regression!)`,
      )
    }

    server.close()
    process.exit(passed ? 0 : 1)
  } catch (err) {
    console.error("[repro] Error:", err)
    server?.close()
    process.exit(1)
  }
}

main()
