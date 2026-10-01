/**
 * MCP resources + docs_get tool for agent-facing documentation.
 */

import { MCP_TOOL_META } from "@drive-coding/core"
import { McpDocsGetInput } from "@drive-coding/core/schemas/session-bus"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import {
  agentDocsIndexEntries,
  buildAgentDocsListBody,
  buildOpenApiServeBody,
  filterIndexByQuery,
  filterIndexByTags,
  findMarkdownByDocId,
  knownAgentDocIds,
} from "../agent-docs-runtime.js"

type JsonResult = {
  content: Array<{ type: "text"; text: string }>
}

type JsonError = {
  isError: true
  content: Array<{ type: "text"; text: string }>
}

type RegisterArkTool = (
  server: McpServer,
  name: string,
  meta: { title: string; description: string },
  ark: { toJsonSchema: () => object; (data: unknown): unknown },
  handler: (parsed: unknown) => Promise<JsonResult | JsonError>,
) => void

function jsonResult(value: unknown): JsonResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] }
}

function jsonError(message: string): JsonError {
  return { isError: true, content: [{ type: "text", text: message }] }
}

export function docsGetFromInput(input: {
  id?: string
  tags?: string[]
  query?: string
}): JsonResult | JsonError {
  const hasId = input.id !== undefined && input.id.trim().length > 0
  const hasTags = input.tags !== undefined && input.tags.length > 0
  const hasQuery = input.query !== undefined && input.query.trim().length > 0

  if (hasId) {
    const id = input.id!.trim()
    const doc = findMarkdownByDocId(id)
    if (!doc) {
      return jsonError(`Unknown document id: ${id}. Known ids: ${knownAgentDocIds().join(", ")}`)
    }
    return { content: [{ type: "text", text: doc.text }] }
  }

  if (hasTags) {
    const docs = filterIndexByTags(input.tags!)
    return jsonResult({ docs })
  }

  if (hasQuery) {
    const docs = filterIndexByQuery(input.query!)
    return jsonResult({ docs })
  }

  const body = buildAgentDocsListBody()
  return jsonResult(body)
}

export function registerAgentDocsMcp(server: McpServer, registerArkTool: RegisterArkTool): void {
  const listBody = () => JSON.stringify(buildAgentDocsListBody())
  const openApiBody = () => JSON.stringify(buildOpenApiServeBody())

  server.registerResource(
    "docs-index",
    "drive-coding://docs/index",
    {
      title: "Agent docs index",
      description: "Catalog of drive-coding agent-facing documents (same as GET /api/docs).",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "drive-coding://docs/index",
          mimeType: "application/json",
          text: listBody(),
        },
      ],
    }),
  )

  server.registerResource(
    "docs-openapi",
    "drive-coding://docs/openapi.json",
    {
      title: "HTTP OpenAPI spec",
      description: "OpenAPI 3.1 spec with x-drive-coding version block (GET /api/openapi.json).",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "drive-coding://docs/openapi.json",
          mimeType: "application/json",
          text: openApiBody(),
        },
      ],
    }),
  )

  for (const entry of agentDocsIndexEntries()) {
    const uri = `drive-coding://docs/${entry.id}`
    server.registerResource(
      `docs-${entry.id}`,
      uri,
      {
        title: entry.title,
        description: entry.summary,
        mimeType: "text/markdown",
      },
      async () => {
        const doc = findMarkdownByDocId(entry.id)
        return {
          contents: [
            {
              uri,
              mimeType: "text/markdown",
              text: doc?.text ?? "",
            },
          ],
        }
      },
    )
  }

  registerArkTool(server, "docs_get", MCP_TOOL_META.docs_get, McpDocsGetInput, async (raw) => {
    const input = raw as typeof McpDocsGetInput.infer
    return docsGetFromInput(input)
  })
}
