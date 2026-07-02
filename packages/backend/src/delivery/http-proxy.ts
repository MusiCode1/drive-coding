/**
 * http-proxy.ts — פרוקסי HTTP שקוף עבור Google + ElevenLabs.
 *
 * Slice 10 Phase 1. עודכן ב-Slice 24 (client-keyed proxy cache).
 *
 * נתיבים (Routes):
 *   /proxy/google/*      → https://generativelanguage.googleapis.com/*
 *   /proxy/elevenlabs/*  → https://api.elevenlabs.io/*
 *
 * הפרוקסי:
 *   1. מסיר את הקידומת /proxy/<provider>.
 *   2. מעביר headers כמו שהם (מוחק "host" כדי שה-upstream יקבל אותם).
 *      Slice 24: מוחק גם x-cache-key ו-x-cache-meta לפני forward.
 *   3. Slice 24: אם הלקוח שלח x-cache-key — משתמש בו (אחרי sanitize) כמפתח.
 *      אחרת — fallback ל-sha256(method|path|body) כרגיל.
 *   4. עבור בקשות הניתנות לשמירה במטמון: בודק מטמון קודם; בחוסר (miss), מפצל את
 *      תגובת ה-body למטמון ברקע תוך כדי הזרמה ל-FE.
 *   5. עבור בקשות שלא נשמרות במטמון: העברה שקופה.
 *
 * שילוב OneCLI: כשהשרת רץ דרך `onecli run --agent voice-acp`,
 * קריאות ה-fetch היוצאות עוברות דרך HTTPS_PROXY של OneCLI שמחליף את
 * ה-headers של ה-API-key הזמניים בהרשאות האמיתיות.
 */

import * as path from "node:path"
import { createLogger } from "@drive-coding/core/log"
import type { Hono } from "hono"
import {
  computeCacheKey,
  createProxyCache,
  isCacheableRequest,
  sanitizeCacheKey,
} from "./proxy-cache.js"
import { resolveProviderAuth } from "./proxy-auth.js"

const log = createLogger("backend.proxy")

// ─── מיפוי ספקים ─────────────────────────────────────────────────────────────

export const PROXY_HOSTS: Record<string, string> = {
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

    // Slice 24: קרא headers של הלקוח לפני המחיקה
    const clientKey = c.req.header("x-cache-key") // אופציונלי
    const clientMetaRaw = c.req.header("x-cache-meta") // אופציונלי JSON

    // Slice 24: מחק x-cache-* — לא אמורים להגיע ל-upstream
    headers.delete("x-cache-key")
    headers.delete("x-cache-meta")

    // קרא body פעם אחת (null עבור GET/HEAD)
    let body: Uint8Array | null = null
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      body = new Uint8Array(await c.req.arrayBuffer())
    }

    // ── קביעת מפתח מטמון ─────────────────────────────────────────────────────
    let cacheKey: string | null = null
    if (clientKey && isCacheableRequest(c.req.method, pathSuffix, body)) {
      // Slice 24: לקוח קבע מפתח — sanitize למניעת path traversal
      cacheKey = await sanitizeCacheKey(clientKey)
    } else if (isCacheableRequest(c.req.method, pathSuffix, body)) {
      // fallback: sha256(method|path|body) — התנהגות ישנה
      cacheKey = await computeCacheKey(c.req.method, pathSuffix, body)
    }

    // ── בדיקת מטמון ──────────────────────────────────────────────────────────
    if (cacheKey) {
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

    // ── הזרקת auth header (voice-keys-direct) ────────────────────────────
    // אם הוגדר מפתח ב-env (ELEVENLABS_API_KEY / GEMINI_API_KEY) — מזריק ל-upstream.
    // אין מפתח → null → placeholder עובר כמו שהוא (OneCLI ממשיך לעבוד כרגיל).
    // לעולם לא ללוגג את הערך — הוא מפתח סודי.
    const auth = resolveProviderAuth(provider, process.env)
    if (auth) headers.set(auth.name, auth.value)

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

      // Slice 24: פענח meta מהלקוח (אם נשלח)
      let meta: Record<string, unknown> | undefined
      if (clientMetaRaw) {
        try {
          meta = JSON.parse(clientMetaRaw) as Record<string, unknown>
          // שמור את ה-key הקריא ב-meta לצורך מחיקה סלקטיבית עתידית
          meta["_clientKey"] = clientKey
        } catch {
          // meta לא תקין — התעלם
        }
      }

      // שמירה במטמון ברקע — אל תמתין
      cacheStreamInBackground(proxyCache, cacheKey, toCache, contentType, meta).catch((e) => {
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
  meta?: Record<string, unknown>,
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

    await cache.set(key, { body: merged, headers: { contentType }, meta })
  } catch {
    // תגובה חלקית — דלג על המטמון, אל תעשה כלום
  }
}
