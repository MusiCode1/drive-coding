#!/usr/bin/env bun
// gen-openapi.mjs — derive docs/agents/openapi.json from ArkType + the live route surface.
// Run with bun only (§0). `--check` exits 1 when the file on disk is stale.

import fs from "node:fs"
import path from "node:path"
import { CreateAgentInputFull } from "../packages/backend/src/delivery/create-agent-input.ts"
import { PatchAgentInput } from "../packages/backend/src/delivery/http-agents.ts"
import {
  CancelParams,
  DeleteSessionParams,
  LoadSessionParams,
  NewSessionParams,
  PromptParams,
} from "../packages/backend/src/session-host/http/rpc.ts"
import { AgentSubscribeBody } from "../packages/core/src/schemas/agent-events.ts"
import { RPC_METHODS } from "../packages/core/src/session/rpc-methods.ts"
import { extractOperations } from "./lint-api-documented.mjs"

const OUT_OF_SCOPE = [
  ["get", "/*"],
  ["all", "/proxy/:provider/*"],
]

const CONTRACT_NONE_DESC =
  "No runtime schema validates this body (measured 2026-09-28). The shape below is descriptive, not enforced."

const root = process.cwd()
const check = process.argv.includes("--check")

function arkToJsonSchema(ark, name) {
  try {
    const full = ark.toJsonSchema()
    const { $schema: _s, ...rest } = full
    return rest
  } catch (e) {
    throw new Error(`toJsonSchema failed for ${name}: ${e.message}`)
  }
}

function pathParameters(routePath) {
  const params = []
  for (const part of routePath.split("/")) {
    if (part.startsWith(":")) {
      const name = part.slice(1)
      params.push({
        name,
        in: "path",
        required: true,
        schema: { type: "string" },
      })
    }
  }
  return params
}

function jsonResponse(description = "OK", status = "200") {
  return {
    [status]: {
      description,
      content: {
        "application/json": {
          schema: { type: "object" },
        },
      },
    },
  }
}

function requestBodyFromSchema(schemaRef, required = true) {
  return {
    required,
    content: {
      "application/json": {
        schema: schemaRef.startsWith("#") ? { $ref: schemaRef } : schemaRef,
      },
    },
  }
}

function contractNoneRequestBody(schema = { type: "object" }) {
  return {
    required: true,
    description: CONTRACT_NONE_DESC,
    content: {
      "application/json": {
        schema,
        "x-drive-coding-contract": "none",
      },
    },
  }
}

const components = {
  schemas: {
    CreateAgentInputFull: arkToJsonSchema(CreateAgentInputFull, "CreateAgentInputFull"),
    PatchAgentInput: arkToJsonSchema(PatchAgentInput, "PatchAgentInput"),
    AgentSubscribeBody: arkToJsonSchema(AgentSubscribeBody, "AgentSubscribeBody"),
    RpcPromptParams: arkToJsonSchema(PromptParams, "PromptParams"),
    RpcCancelParams: arkToJsonSchema(CancelParams, "CancelParams"),
    RpcLoadSessionParams: arkToJsonSchema(LoadSessionParams, "LoadSessionParams"),
    RpcNewSessionParams: arkToJsonSchema(NewSessionParams, "NewSessionParams"),
    RpcDeleteSessionParams: arkToJsonSchema(DeleteSessionParams, "DeleteSessionParams"),
  },
}

const rpcMethodEnum = Object.values(RPC_METHODS)

const rpcRequestBody = {
  required: true,
  description: `${CONTRACT_NONE_DESC} The \`params\` object is validated per \`method\` for five management methods (see component schemas Rpc*Params); other methods use ad-hoc params at runtime.`,
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: {
          method: { type: "string", enum: rpcMethodEnum },
          params: {
            oneOf: [
              { $ref: "#/components/schemas/RpcPromptParams" },
              { $ref: "#/components/schemas/RpcCancelParams" },
              { $ref: "#/components/schemas/RpcLoadSessionParams" },
              { $ref: "#/components/schemas/RpcNewSessionParams" },
              { $ref: "#/components/schemas/RpcDeleteSessionParams" },
              { type: "object", additionalProperties: true },
            ],
          },
          waitMs: { type: "integer", minimum: 1, maximum: 60000 },
        },
        required: ["method"],
        additionalProperties: true,
      },
      "x-drive-coding-contract": "none",
    },
  },
}

/** Per-operation overrides keyed by `method path`. */
const SPECIAL = {
  "post /api/agents": {
    requestBody: requestBodyFromSchema("#/components/schemas/CreateAgentInputFull"),
  },
  "patch /api/agents/:id": {
    requestBody: requestBodyFromSchema("#/components/schemas/PatchAgentInput"),
  },
  "post /api/agents/:id/subscribe": {
    requestBody: requestBodyFromSchema("#/components/schemas/AgentSubscribeBody"),
  },
  "post /api/agents/:id/rpc": {
    requestBody: rpcRequestBody,
    "x-drive-coding-contract": "none",
    description: CONTRACT_NONE_DESC,
  },
  "post /api/agents/:id/reply": {
    requestBody: contractNoneRequestBody({
      type: "object",
      properties: {
        kind: { type: "string" },
      },
      additionalProperties: true,
    }),
    "x-drive-coding-contract": "none",
    description: CONTRACT_NONE_DESC,
  },
  "get /api/agents/:id/events": {
    responses: {
      200: {
        description: "Server-Sent Events stream",
        content: {
          "text/event-stream": {
            schema: { type: "string" },
          },
        },
      },
    },
  },
  "post /api/recordings": {
    requestBody: contractNoneRequestBody({
      type: "object",
      properties: {
        audioBase64: { type: "string" },
        mimeType: { type: "string" },
      },
      required: ["audioBase64", "mimeType"],
    }),
    responses: jsonResponse("Created", "201"),
  },
  "post /api/client-log": {
    requestBody: contractNoneRequestBody({
      type: "object",
      properties: {
        entries: { type: "array", items: { type: "object" } },
      },
    }),
  },
  "post /api/voice/live/token": {
    requestBody: contractNoneRequestBody({
      type: "object",
      properties: {
        systemInstruction: { type: "string" },
        actions: { type: "array", items: { type: "string" } },
        model: { type: "string" },
        voiceName: { type: "string" },
      },
      required: ["systemInstruction", "actions"],
    }),
  },
}

function buildOperation(method, routePath) {
  const key = `${method} ${routePath}`
  const base = {
    operationId: key.replace(/[^a-zA-Z0-9]+/g, "_"),
    summary: `${method.toUpperCase()} ${routePath}`,
    parameters: pathParameters(routePath),
    responses: jsonResponse(),
    ...SPECIAL[key],
  }
  if (base.parameters?.length === 0) delete base.parameters
  return base
}

function buildPaths() {
  const { operations } = extractOperations(root)
  const inScope = operations.filter(
    (o) => !OUT_OF_SCOPE.some(([m, p]) => m === o.method && p === o.path),
  )
  const paths = {}
  for (const op of inScope) {
    if (!paths[op.path]) paths[op.path] = {}
    paths[op.path][op.method] = buildOperation(op.method, op.path)
  }
  return { paths, count: inScope.length }
}

const coreDocs = fs.readFileSync(path.join(root, "packages/core/src/docs/index.ts"), "utf8")
const docsVersion = coreDocs.match(/DOCS_VERSION\s*=\s*"([^"]+)"/)?.[1]
if (!docsVersion) {
  console.error("🔴 DOCS_VERSION not found")
  process.exit(1)
}

const { paths, count } = buildPaths()
if (count !== 36) {
  console.error(`🔴 expected 36 documentable operations, got ${count}`)
  process.exit(1)
}

const spec = {
  openapi: "3.1.1",
  info: {
    title: "drive-coding HTTP API",
    version: docsVersion,
    description:
      "Documentable Hono routes on the drive-coding backend. Generated from code — run `bun scripts/gen-openapi.mjs` to refresh.",
  },
  paths,
  components,
}

const target = path.join(root, "docs/agents/openapi.json")
const serialized = `${JSON.stringify(spec, null, 2)}\n`

if (check) {
  if (!fs.existsSync(target)) process.exit(1)
  const onDisk = JSON.parse(fs.readFileSync(target, "utf8"))
  process.exit(JSON.stringify(onDisk) === JSON.stringify(spec) ? 0 : 1)
}
fs.writeFileSync(target, serialized)
console.log(`✅ docs/agents/openapi.json — ${count} operations`)
