/**
 * proxy-mem-regression.test.ts — regression guard for the Gemini proxy OOM bug.
 *
 * Slice: proxy-tap-memory §5.1 (DoD: RSS delta < 50MB under 256MB mock stream)
 *
 * Reproduces the exact OOM scenario that crashed the BE (2026-07-03/04):
 *   - Mocks global fetch to return a 256MB Gemini SSE stream
 *   - Sends POST /proxy/google/.../streamGenerateContent?alt=sse via registerProxyHttp
 *   - Does NOT read the response body (client.body.cancel() — simulates a disconnected FE)
 *   - Measures RSS before and after — delta must be < 50MB
 *
 * With the old tee() implementation: delta ~ 260MB (full buffer in unread branch).
 * With the new TransformStream peek: delta ~ 19MB (client-paced, bounded).
 *
 * This test supersedes scripts/repro-proxy-mem.mjs, which could not run from the repo
 * root because hono is a dep of @drive-coding/backend and was not hoisted. Moving to
 * vitest keeps it CI-runnable and co-located with the production code under test.
 *
 * Note on timeout: streaming 256MB takes ~5–15s depending on CPU. Allow 60s.
 */

import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const STREAM_SIZE_MB = 256
const RSS_BUDGET_MB = 50

function buildFakeSseStream(totalMb: number): ReadableStream<Uint8Array> {
  const CHUNK_SIZE = 64 * 1024
  const totalBytes = totalMb * 1024 * 1024
  const audioBase64 = "A".repeat(CHUNK_SIZE - 200)
  const audioLine = `data: {"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"audio/mp3","data":"${audioBase64}"}}],"role":"model"}}]}\r\n\r\n`
  const usageLine = `data: {"candidates":[],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":50,"candidatesTokensDetails":[{"modality":"AUDIO","tokenCount":50}]}}\r\n\r\ndata: [DONE]\r\n\r\n`
  const encoder = new TextEncoder()
  const audioBytes = encoder.encode(audioLine)
  const usageBytes = encoder.encode(usageLine)
  let emitted = 0

  return new ReadableStream<Uint8Array>({
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

describe("proxy-mem-regression — 256MB stream, client disconnected", () => {
  let tmpDir: string
  let registerProxyHttp: (
    app: import("hono").Hono,
    opts?: {
      cacheBaseDir?: string
      usageStore?: import("../src/usage/usage-store.js").UsageStore
    },
  ) => void

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "proxy-mem-reg-"))
    const mod = await import("../src/delivery/http-proxy.js")
    registerProxyHttp = mod.registerProxyHttp
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it(
    `RSS delta < ${RSS_BUDGET_MB}MB when FE client cancels a ${STREAM_SIZE_MB}MB Gemini stream`,
    async () => {
      // Install fetch mock BEFORE registering the proxy
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(buildFakeSseStream(STREAM_SIZE_MB), {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        ),
      )

      const recorded: Array<{ inputTokens?: number; audioTokens?: number }> = []
      const usageStore = {
        record(event: { inputTokens?: number; audioTokens?: number; [k: string]: unknown }) {
          recorded.push({ inputTokens: event.inputTokens, audioTokens: event.audioTokens })
        },
      } as import("../src/usage/usage-store.js").UsageStore

      const { Hono } = await import("hono")
      const app = new Hono()
      registerProxyHttp(app, { cacheBaseDir: tmpDir, usageStore, env: process.env })

      // Warmup: one full request so JIT and allocators stabilise before measuring
      {
        vi.stubGlobal(
          "fetch",
          vi.fn().mockResolvedValue(
            new Response(
              new TextEncoder().encode(
                `data: {"candidates":[],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1}}\r\n\r\ndata: [DONE]\r\n\r\n`,
              ),
              { status: 200, headers: { "content-type": "text/event-stream" } },
            ),
          ),
        )
        const warmupReq = new Request(
          "http://localhost/proxy/google/v1beta/models/gemini-flash:streamGenerateContent?alt=sse",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ contents: [] }),
          },
        )
        const warmupRes = await app.fetch(warmupReq)
        await warmupRes.body?.cancel()
      }

      // Restore the 256MB mock for the actual measurement
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(buildFakeSseStream(STREAM_SIZE_MB), {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        ),
      )

      if (globalThis.gc) globalThis.gc()
      await new Promise((r) => setTimeout(r, 100))

      const rssBefore = process.memoryUsage().rss

      const req = new Request(
        "http://localhost/proxy/google/v1beta/models/gemini-flash:streamGenerateContent?alt=sse",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: "regression-test" }] }] }),
        },
      )
      const res = await app.fetch(req)
      expect(res.status).toBe(200)

      // Simulate a disconnected FE client: cancel the body without reading it.
      // With the old tee() this caused the full 256MB to buffer in the tap branch.
      // With TransformStream the stream is client-paced — no tap-branch buffering.
      await res.body?.cancel()

      // Allow GC + outstanding microtasks to settle
      if (globalThis.gc) globalThis.gc()
      await new Promise((r) => setTimeout(r, 200))

      const rssAfter = process.memoryUsage().rss
      const deltaMb = (rssAfter - rssBefore) / 1024 / 1024

      // Diagnostic output visible in CI logs
      console.log(
        `[proxy-mem-regression] RSS before: ${Math.round(rssBefore / 1024 / 1024)}MB | after: ${Math.round(rssAfter / 1024 / 1024)}MB | delta: ${deltaMb.toFixed(1)}MB`,
      )

      // Core assertion: delta must be well under 50MB (stream was not fully buffered)
      expect(deltaMb).toBeLessThan(RSS_BUDGET_MB)
    },
    60_000, // allow 60s — streaming 256MB takes 5-15s
  )
})
