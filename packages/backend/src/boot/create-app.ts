/**
 * create-app.ts — Hono instance with CORS for server boot.
 */

import type { DriveCodingConfig } from "@drive-coding/core/config/schema"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { effectiveCorsOrigins } from "../delivery/cors-config.js"

export function createAppWithCors(config: DriveCodingConfig): Hono {
  const app = new Hono()
  const corsOriginsRaw = config.corsOrigins !== undefined ? config.corsOrigins.join(",") : undefined
  app.use(
    "*",
    cors({ origin: effectiveCorsOrigins(corsOriginsRaw, config.publicBaseUrl), credentials: true }),
  )
  return app
}
