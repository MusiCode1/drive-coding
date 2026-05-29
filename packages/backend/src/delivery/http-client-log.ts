/**
 * POST /api/client-log — מקבל רשומות לוג מקובצות מהדפדפן (frontend).
 *
 * מאמת, מגביל קצב (rate-limits), ופולט מחדש רשומות דרך הלוגר של השרת
 * תחת ה-namespace של `client.<original-ns>`.
 *
 * מגבלת קצב: מקסימום 500 רשומות לכל IP בדקה.
 */

import type { Fields } from "@drive-coding/core/log"
import { createLogger } from "@drive-coding/core/log"
import { type } from "arktype"
import type { Hono } from "hono"

// ── סכימת ArkType ────────────────────────────────────────────────────────────

const ClientLogEntry = type({
  ts: "number",
  level: "'error'|'warn'|'info'|'debug'|'trace'",
  ns: "string",
  "msg?": "string",
  "fields?": "object",
})

const ClientLogPayload = type({ entries: ClientLogEntry.array() })

// ── לוגר ────────────────────────────────────────────────────────────────────

const clientLog = createLogger("client")

// ── הגבלת קצב ─────────────────────────────────────────────────────────────

type Bucket = { count: number; resetAt: number }
const ipBuckets = new Map<string, Bucket>()

function checkRateLimit(ip: string, count: number): boolean {
  const now = Date.now()
  let bucket = ipBuckets.get(ip)
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + 60_000 }
    ipBuckets.set(ip, bucket)
  }
  bucket.count += count
  return bucket.count <= 500
}

// ── טיפולן ───────────────────────────────────────────────────────────────────

export function registerClientLogHttp(app: Hono): void {
  app.post("/api/client-log", async (c) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "anon"

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "bad json" }, 400)
    }

    const parsed = ClientLogPayload(body)
    if (parsed instanceof type.errors) {
      return c.json({ error: parsed.summary }, 400)
    }

    if (!checkRateLimit(ip, parsed.entries.length)) {
      return c.body(null, 429)
    }

    for (const e of parsed.entries) {
      const subLog = clientLog.ns(e.ns)
      const fields: Fields = (e.fields ?? {}) as Fields
      const msg = e.msg ?? ""
      // קורא למתודה ברמה המתאימה
      if (e.level === "error") {
        subLog.error(fields, msg)
      } else if (e.level === "warn") {
        subLog.warn(fields, msg)
      } else if (e.level === "info") {
        subLog.info(fields, msg)
      } else if (e.level === "debug") {
        subLog.debug(fields, msg)
      } else if (e.level === "trace") {
        subLog.trace(fields, msg)
      }
    }

    return c.body(null, 204)
  })
}
