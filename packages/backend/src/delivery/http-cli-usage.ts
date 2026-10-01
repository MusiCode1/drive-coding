/**
 * http-cli-usage.ts — GET /api/usage/clis (slice usage-per-cli).
 */

import type { Hono } from "hono"
import type { ProjectsRegistry } from "../app/projects-registry.js"
import { aggregateCliUsage } from "../usage/aggregate-cli-usage.js"
import type { TokenUsageStore } from "../usage/token-usage-store.js"

export function registerCliUsageHttp(
  app: Hono,
  deps: { tokenUsageStore: TokenUsageStore; projectsRegistry: ProjectsRegistry },
): void {
  app.get("/api/usage/clis", async (c) => {
    const cwdRaw = c.req.query("cwd")
    const cwd = cwdRaw !== undefined && cwdRaw !== "" ? cwdRaw : undefined
    const projects = await deps.projectsRegistry.getProjects()
    const records = deps.tokenUsageStore.listRecords(cwd !== undefined ? { cwd } : {})
    return c.json({ clis: aggregateCliUsage(records, projects, cwd !== undefined ? { cwd } : {}) })
  })
}
