/**
 * Agent-facing docs — GET /api/docs, GET /api/docs/:id, GET /api/openapi.json
 */

import { PUBLISHED_CONTRACT_VERSION } from "@drive-coding/core/contract-version"
import type { Context, Hono } from "hono"
import {
  agentDocsVersionBlock,
  buildAgentDocsListBody,
  buildOpenApiServeBody,
  findMarkdownByDocId,
} from "../agent-docs-runtime.js"

const VERSION_HEADERS = [
  "X-Drive-Coding-App-Version",
  "X-Drive-Coding-Docs-Version",
  "X-Drive-Coding-Route-Count",
  "X-Drive-Coding-Generated-At",
] as const

function setVersionHeaders(
  c: { header: (name: string, value: string) => void },
  block: ReturnType<typeof agentDocsVersionBlock>,
): void {
  c.header(VERSION_HEADERS[0], block.appVersion)
  c.header(VERSION_HEADERS[1], block.docsVersion)
  c.header(VERSION_HEADERS[2], String(block.routeCount))
  c.header(VERSION_HEADERS[3], block.generatedAt)
}

function setContractVersionHeader(c: Context): void {
  if (PUBLISHED_CONTRACT_VERSION !== undefined) {
    c.header("X-Drive-Coding-Contract-Version", PUBLISHED_CONTRACT_VERSION)
  }
}

export function registerDocsHttp(app: Hono): void {
  app.get("/api/docs", (c) => {
    setContractVersionHeader(c)
    return c.json(buildAgentDocsListBody())
  })

  app.get("/api/docs/:id", (c) => {
    const id = c.req.param("id")
    const doc = findMarkdownByDocId(id)
    if (!doc) {
      return c.json({ error: `Unknown document id: ${id}` }, 404)
    }
    const block = agentDocsVersionBlock()
    setVersionHeaders(c, block)
    setContractVersionHeader(c)
    return c.body(doc.text, 200, {
      "Content-Type": "text/markdown; charset=utf-8",
    })
  })

  app.get("/api/openapi.json", (c) => {
    setContractVersionHeader(c)
    return c.json(buildOpenApiServeBody())
  })
}
