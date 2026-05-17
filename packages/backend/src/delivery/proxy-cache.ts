/**
 * proxy-cache.ts — Cache abstraction for the transparent HTTP proxy.
 *
 * Slice 10 Phase 1.
 *
 * Stores cacheable responses (Gemini generateContent + ElevenLabs TTS stream)
 * on disk. Each entry consists of:
 *   - body file:    {baseDir}/proxy/{key}
 *   - headers file: {baseDir}/proxy/{key}.headers (JSON sidecar)
 */

import { createDiskCache } from "../voice/cache.js"

// ─── Types ────────────────────────────────────────────────────────────────────

export type CachedEntry = {
  body: Uint8Array
  headers: { contentType: string }
}

// ─── Cache rules ──────────────────────────────────────────────────────────────

/**
 * Returns true if this request's response should be cached.
 *
 * Rules (from §3.3 of the brief):
 *   POST /v1beta/models/*:generateContent              → cached
 *   POST /v1/text-to-speech/{voiceId}/stream            → cached
 *   POST /v1beta/models/*:streamGenerateContent         → NOT cached (streaming generative)
 *   Everything else                                     → NOT cached
 */
export function isCacheableRequest(method: string, path: string, body: Uint8Array | null): boolean {
  if (method !== "POST" || !body) return false
  // Gemini generateContent (translate, narrate, STT) — but NOT streamGenerateContent
  if (/^\/v1beta\/models\/[^/]+:generateContent\b/.test(path)) return true
  // ElevenLabs streaming TTS
  if (/^\/v1\/text-to-speech\/[^/]+\/stream\b/.test(path)) return true
  return false
}

/**
 * Computes a deterministic cache key for a request.
 * key = sha256(method + "|" + path + "|" + body_as_string).hex
 */
export async function computeCacheKey(
  method: string,
  path: string,
  body: Uint8Array | null,
): Promise<string> {
  const bodyStr = body ? new TextDecoder().decode(body) : ""
  const raw = `${method}|${path}|${bodyStr}`
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw))
  return Buffer.from(hashBuffer).toString("hex")
}

// ─── Proxy cache factory ──────────────────────────────────────────────────────

/**
 * Creates a disk-backed proxy cache.
 * baseDir: root directory (e.g. "data/cache/proxy").
 */
export function createProxyCache(baseDir: string) {
  // Two logical caches sharing the same namespace: body + sidecar headers.
  // We use a single createDiskCache instance with two key types:
  //   key         → body (Uint8Array)
  //   key.headers → JSON-encoded header metadata
  const store = createDiskCache<Uint8Array>({
    namespace: "proxy",
    baseDir,
    encode: (v) => v,
    decode: (v) => v,
  })

  return {
    async get(key: string): Promise<CachedEntry | null> {
      const body = await store.get(key)
      if (!body) return null

      const headersRaw = await store.get(`${key}.headers`)
      let headers: { contentType: string } = { contentType: "application/octet-stream" }
      if (headersRaw) {
        try {
          headers = JSON.parse(new TextDecoder().decode(headersRaw)) as {
            contentType: string
          }
        } catch {
          // use default
        }
      }

      return { body, headers }
    },

    async set(key: string, entry: CachedEntry): Promise<void> {
      await store.set(key, entry.body)
      await store.set(`${key}.headers`, new TextEncoder().encode(JSON.stringify(entry.headers)))
    },
  }
}

export type ProxyCache = ReturnType<typeof createProxyCache>
