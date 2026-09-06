/**
 * Gate for GET /api/fs/browse?via=webdav — register before the local-fs handler.
 */
import type { Hono } from "hono"
import { browseWebdav, readWebdavBrowseConfig } from "./webdav-browse.js"

export function registerWebdavBrowseGate(app: Hono): void {
  app.use("/api/fs/browse", async (c, next) => {
    if (c.req.query("via") !== "webdav") {
      await next()
      return
    }
    const cfg = readWebdavBrowseConfig()
    if (!cfg) {
      return c.json({ error: "webdav browse not configured" }, 503)
    }
    const rawPath = c.req.query("path")
    if (!rawPath) {
      return c.json({ error: "path query required" }, 400)
    }
    const showHidden = c.req.query("showHidden") === "true"
    const result = await browseWebdav(rawPath, { showHidden, config: cfg })
    if (!result.ok) {
      return c.json({ error: result.error }, result.status)
    }
    return c.json(result.result)
  })
}
