/**
 * http-proxy.ts — Transparent HTTP proxy for Google + ElevenLabs.
 *
 * Slice 10 Phase 1.
 *
 * Routes:
 *   /proxy/google/*      → https://generativelanguage.googleapis.com/*
 *   /proxy/elevenlabs/*  → https://api.elevenlabs.io/*
 *
 * The proxy:
 *   1. Strips the /proxy/<provider> prefix.
 *   2. Forwards headers as-is (deleting "host" so upstream accepts them).
 *   3. For cacheable requests: checks cache first; on miss, tees the response
 *      body to cache in the background while streaming to FE.
 *   4. For non-cacheable requests: transparent passthrough.
 *
 * OneCLI integration: when the BE runs via `onecli run --agent voice-acp`,
 * outbound fetch goes through the OneCLI HTTPS_PROXY which replaces the
 * placeholder API-key headers with real credentials.
 */

import * as path from "node:path"
import { createLogger } from "@drive-coding/core/log"
import type { Hono } from "hono"
import { computeCacheKey, createProxyCache, isCacheableRequest } from "./proxy-cache.js"

const log = createLogger("backend.proxy")

// ─── Provider map ─────────────────────────────────────────────────────────────

const PROXY_HOSTS: Record<string, string> = {
  google: "https://generativelanguage.googleapis.com",
  elevenlabs: "https://api.elevenlabs.io",
}

// ─── Cache singleton ──────────────────────────────────────────────────────────

// Lazily created on first registerProxyHttp call.
let _cache: ReturnType<typeof createProxyCache> | null = null

function getCache(cacheBaseDir: string) {
  if (!_cache) {
    _cache = createProxyCache(cacheBaseDir)
  }
  return _cache
}

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerProxyHttp(app: Hono, opts: { cacheBaseDir?: string } = {}): void {
  const cacheBaseDir = opts.cacheBaseDir ?? path.resolve("data/cache/proxy")
  const proxyCache = getCache(cacheBaseDir)

  app.all("/proxy/:provider/*", async (c) => {
    const provider = c.req.param("provider")
    const upstreamBase = PROXY_HOSTS[provider]
    if (!upstreamBase) {
      return c.json({ error: "unknown provider" }, 404)
    }

    // Strip the /proxy/<provider> prefix from the pathname
    const fullPath = new URL(c.req.url).pathname
    const pathSuffix = fullPath.replace(`/proxy/${provider}`, "")
    const search = new URL(c.req.url).search
    const targetUrl = `${upstreamBase}${pathSuffix}${search}`

    // Build forwarded headers — copy as-is, delete "host" (breaks upstream)
    const headers = new Headers(c.req.raw.headers)
    headers.delete("host")

    // Read body once (null for GET/HEAD)
    let body: Uint8Array | null = null
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      body = new Uint8Array(await c.req.arrayBuffer())
    }

    // ── Cache check ──────────────────────────────────────────────────────────
    let cacheKey: string | null = null
    if (isCacheableRequest(c.req.method, pathSuffix, body)) {
      cacheKey = await computeCacheKey(c.req.method, pathSuffix, body)
      const cached = await proxyCache.get(cacheKey)
      if (cached) {
        log.debug({ provider, path: pathSuffix }, "proxy cache hit")
        return new Response(cached.body, {
          status: 200,
          headers: {
            "content-type": cached.headers.contentType,
            "x-cache": "hit",
          },
        })
      }
    }

    // ── Forward to upstream ──────────────────────────────────────────────────
    log.debug({ provider, path: pathSuffix, cacheKey }, "proxy cache miss — forwarding")

    let res: Response
    try {
      res = await fetch(targetUrl, {
        method: c.req.method,
        headers,
        body: body ?? undefined,
        signal: c.req.raw.signal,
      })
    } catch (e) {
      log.error({ err: e, provider, path: pathSuffix }, "upstream fetch failed")
      return c.json({ error: "upstream fetch failed" }, 502)
    }

    // ── Build response headers ────────────────────────────────────────────────
    // CRITICAL: Bun/fetch transparently decompresses gzip/deflate response bodies,
    // but the original `content-encoding` and `content-length` headers describe
    // the COMPRESSED body. Forwarding them as-is makes the FE try to decompress
    // an already-decompressed payload → ERR_CONTENT_DECODING_FAILED.
    // Strip both — the browser will read the decompressed body via chunked transfer.
    const sanitizedHeaders = new Headers(res.headers)
    sanitizedHeaders.delete("content-encoding")
    sanitizedHeaders.delete("content-length")

    // ── Tee for cache on success ──────────────────────────────────────────────
    if (cacheKey && res.ok && res.body) {
      const [toClient, toCache] = res.body.tee()
      const contentType = sanitizedHeaders.get("content-type") ?? "application/octet-stream"

      // Cache in background — do not await
      cacheStreamInBackground(proxyCache, cacheKey, toCache, contentType).catch((e) => {
        log.warn({ err: e, cacheKey }, "background cache write failed")
      })

      sanitizedHeaders.set("x-cache", "miss")
      return new Response(toClient, {
        status: res.status,
        headers: sanitizedHeaders,
      })
    }

    // Transparent passthrough (non-cacheable or upstream error)
    return new Response(res.body, {
      status: res.status,
      headers: sanitizedHeaders,
    })
  })
}

// ─── Background cache write ───────────────────────────────────────────────────

async function cacheStreamInBackground(
  cache: ReturnType<typeof createProxyCache>,
  key: string,
  stream: ReadableStream<Uint8Array>,
  contentType: string,
): Promise<void> {
  const chunks: Uint8Array[] = []
  const reader = stream.getReader()
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
    }

    // Merge all chunks into a single Uint8Array
    const totalLength = chunks.reduce((s, c) => s + c.length, 0)
    const merged = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.length
    }

    await cache.set(key, { body: merged, headers: { contentType } })
  } catch {
    // Partial response — skip cache, no-op
  }
}
