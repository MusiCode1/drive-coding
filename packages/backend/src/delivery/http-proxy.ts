/**
 * http-proxy.ts — פרוקסי HTTP שקוף עבור Google + ElevenLabs.
 *
 * Slice 10 Phase 1.
 *
 * נתיבים (Routes):
 *   /proxy/google/*      → https://generativelanguage.googleapis.com/*
 *   /proxy/elevenlabs/*  → https://api.elevenlabs.io/*
 *
 * הפרוקסי:
 *   1. מסיר את הקידומת /proxy/<provider>.
 *   2. מעביר headers כמו שהם (מוחק "host" כדי שה-upstream יקבל אותם).
 *   3. עבור בקשות הניתנות לשמירה במטמון: בודק מטמון קודם; בחוסר (miss), מפצל את 
 *      תגובת ה-body למטמון ברקע תוך כדי הזרמה ל-FE.
 *   4. עבור בקשות שלא נשמרות במטמון: העברה שקופה.
 *
 * שילוב OneCLI: כשהשרת רץ דרך `onecli run --agent voice-acp`,
 * קריאות ה-fetch היוצאות עוברות דרך HTTPS_PROXY של OneCLI שמחליף את
 * ה-headers של ה-API-key הזמניים בהרשאות האמיתיות.
 */

import * as path from "node:path"
import { createLogger } from "@drive-coding/core/log"
import type { Hono } from "hono"
import { computeCacheKey, createProxyCache, isCacheableRequest } from "./proxy-cache.js"

const log = createLogger("backend.proxy")

// ─── מיפוי ספקים ─────────────────────────────────────────────────────────────

const PROXY_HOSTS: Record<string, string> = {
  google: "https://generativelanguage.googleapis.com",
  elevenlabs: "https://api.elevenlabs.io",
}

// ─── סינגלטון מטמון ──────────────────────────────────────────────────────────

// נוצר בעצלנות בקריאה הראשונה ל-registerProxyHttp.
let _cache: ReturnType<typeof createProxyCache> | null = null

function getCache(cacheBaseDir: string) {
  if (!_cache) {
    _cache = createProxyCache(cacheBaseDir)
  }
  return _cache
}

// ─── רישום ─────────────────────────────────────────────────────────────

export function registerProxyHttp(app: Hono, opts: { cacheBaseDir?: string } = {}): void {
  const cacheBaseDir = opts.cacheBaseDir ?? path.resolve("data/cache/proxy")
  const proxyCache = getCache(cacheBaseDir)

  app.all("/proxy/:provider/*", async (c) => {
    const provider = c.req.param("provider")
    const upstreamBase = PROXY_HOSTS[provider]
    if (!upstreamBase) {
      return c.json({ error: "unknown provider" }, 404)
    }

    // הסר את הקידומת /proxy/<provider> משם הנתיב
    const fullPath = new URL(c.req.url).pathname
    const pathSuffix = fullPath.replace(`/proxy/${provider}`, "")
    const search = new URL(c.req.url).search
    const targetUrl = `${upstreamBase}${pathSuffix}${search}`

    // בנה headers להעברה — העתק כמו שהם, מחק "host" (שובר upstream)
    const headers = new Headers(c.req.raw.headers)
    headers.delete("host")

    // קרא body פעם אחת (null עבור GET/HEAD)
    let body: Uint8Array | null = null
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      body = new Uint8Array(await c.req.arrayBuffer())
    }

    // ── בדיקת מטמון ──────────────────────────────────────────────────────────
    let cacheKey: string | null = null
    if (isCacheableRequest(c.req.method, pathSuffix, body)) {
      cacheKey = await computeCacheKey(c.req.method, pathSuffix, body)
      const cached = await proxyCache.get(cacheKey)
      if (cached) {
        log.info({ provider, path: pathSuffix }, "proxy cache hit")
        return new Response(cached.body, {
          status: 200,
          headers: {
            "content-type": cached.headers.contentType,
            "x-cache": "hit",
          },
        })
      }
    }

    // ── העברה ל-upstream ──────────────────────────────────────────────────
    log.info(
      { provider, path: pathSuffix, cacheable: cacheKey !== null },
      "proxy → upstream",
    )

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

    // ── תצפיתנות לשגיאות upstream ────────────────────────────────────
    // סטטוס שאינו 2xx מה-upstream אינו כשל רשת — ה-fetch הסתיים בהצלחה.
    // אבל ה-FE רואה 401/400/500 מ-elevenlabs/google והשרת היה
    // שקט עד עכשיו. מבצע לוג כדי שבעיות הרשאות / מכסה יהיו גלויות.
    if (!res.ok) {
      log.warn(
        { provider, path: pathSuffix, status: res.status },
        "proxy upstream non-2xx",
      )
    }

    // ── הרכבת headers לתגובה ────────────────────────────────────────────────
    // קריטי: Bun/fetch מפענח gzip/deflate בשקיפות,
    // אבל header ה-`content-encoding` וה-`content-length` המקוריים מתארים
    // את ה-body הדחוס. העברתם כמו שהם גורמת ל-FE לנסות לפענח
    // payload שכבר פוענח → ERR_CONTENT_DECODING_FAILED.
    // מסירים את שניהם — הדפדפן קורא את ה-body המפוענח דרך chunked transfer.
    const sanitizedHeaders = new Headers(res.headers)
    sanitizedHeaders.delete("content-encoding")
    sanitizedHeaders.delete("content-length")

    // ── פיצול למטמון בהצלחה ──────────────────────────────────────────────
    if (cacheKey && res.ok && res.body) {
      const [toClient, toCache] = res.body.tee()
      const contentType = sanitizedHeaders.get("content-type") ?? "application/octet-stream"

      // שמירה במטמון ברקע — אל תמתין
      cacheStreamInBackground(proxyCache, cacheKey, toCache, contentType).catch((e) => {
        log.warn({ err: e, cacheKey }, "background cache write failed")
      })

      sanitizedHeaders.set("x-cache", "miss")
      return new Response(toClient, {
        status: res.status,
        headers: sanitizedHeaders,
      })
    }

    // העברה שקופה (לא ניתן לשמור במטמון או שגיאת upstream)
    return new Response(res.body, {
      status: res.status,
      headers: sanitizedHeaders,
    })
  })
}

// ─── כתיבה למטמון ברקע ───────────────────────────────────────────────────

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

    // מזג את כל ה-chunks ל-Uint8Array אחד
    const totalLength = chunks.reduce((s, c) => s + c.length, 0)
    const merged = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.length
    }

    await cache.set(key, { body: merged, headers: { contentType } })
  } catch {
    // תגובה חלקית — דלג על המטמון, אל תעשה כלום
  }
}
