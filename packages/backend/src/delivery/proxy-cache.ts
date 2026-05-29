/**
 * proxy-cache.ts — הפשטת מטמון עבור פרוקסי ה-HTTP השקוף.
 *
 * Slice 10 Phase 1.
 *
 * שומר תגובות הניתנות לשמירה במטמון (Gemini generateContent + ElevenLabs TTS stream)
 * על הדיסק. כל רשומה מורכבת מ:
 *   - קובץ body:    {baseDir}/proxy/{key}
 *   - קובץ headers: {baseDir}/proxy/{key}.headers (קובץ JSON נלווה)
 */

import { createDiskCache } from "../voice/cache.js"

// ─── סוגים ────────────────────────────────────────────────────────────────────

export type CachedEntry = {
  body: Uint8Array
  headers: { contentType: string }
}

// ─── Cache rules ──────────────────────────────────────────────────────────────

/**
 * מחזיר true אם התגובה של בקשה זו צריכה להישמר במטמון.
 *
 * כללים (מ-§3.3 של ה-brief):
 *   POST /v1beta/models/*:generateContent              → נשמר במטמון (cached)
 *   POST /v1/text-to-speech/{voiceId}/stream            → נשמר במטמון (cached)
 *   POST /v1beta/models/*:streamGenerateContent         → לא נשמר במטמון (streaming generative)
 *   כל השאר                                     → לא נשמר במטמון
 */
export function isCacheableRequest(method: string, path: string, body: Uint8Array | null): boolean {
  if (method !== "POST" || !body) return false
  // Gemini generateContent (translate, narrate, STT) — אבל לא streamGenerateContent
  if (/^\/v1beta\/models\/[^/]+:generateContent\b/.test(path)) return true
  // ElevenLabs streaming TTS
  if (/^\/v1\/text-to-speech\/[^/]+\/stream\b/.test(path)) return true
  return false
}

/**
 * מחשב מפתח מטמון דטרמיניסטי עבור בקשה.
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

// ─── Factory למטמון פרוקסי ──────────────────────────────────────────────────────

/**
 * יוצר מטמון פרוקסי מבוסס דיסק.
 * baseDir: ספריית השורש (למשל "data/cache/proxy").
 */
export function createProxyCache(baseDir: string) {
  // שני מטמונים לוגיים החולקים את אותו namespace: גוף (body) + תגיות נלוות (headers).
  // אנו משתמשים במופע אחד של createDiskCache עם שני סוגי מפתחות:
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
          // השתמש בברירת מחדל
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
