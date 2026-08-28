#!/usr/bin/env node
// mcp-smoke — real MCP client against a live drive-coding BE (slice session-bus-mcp).
//
//   node scripts/mcp-smoke.mjs --base http://127.0.0.1:<port>
//     initialize → tools/list → tools/call session_list
//
//   node scripts/mcp-smoke.mjs --base http://127.0.0.1:<port> --e2e
//     session_open(cursor) → session_send → text in response → session_close
//     (wired in C2)
//
// Do not default --base to :4000/:4001 (live deployments).
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

const rest = process.argv.slice(2)
const get = (k, d) => {
  const i = rest.indexOf(k)
  return i >= 0 ? rest[i + 1] : d
}
const has = (k) => rest.includes(k)

const BASE = get("--base")
if (!BASE) {
  console.error("mcp-smoke: --base is required (do not use :4000/:4001)")
  process.exit(4)
}
const base = String(BASE).replace(/\/$/, "")

function toolText(result) {
  const block = (result.content ?? []).find((c) => c.type === "text")
  return block?.text ?? ""
}

const client = new Client({ name: "mcp-smoke", version: "0.0.0" })
const transport = new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`))
await client.connect(transport)

const { tools } = await client.listTools()
const names = tools.map((t) => t.name)
console.log(`tools (${names.length}): ${names.join(" ")}`)

const listed = await client.callTool({ name: "session_list", arguments: {} })
if (listed.isError) {
  console.error("session_list error:", toolText(listed))
  await client.close()
  process.exit(1)
}
console.log(toolText(listed))

if (has("--e2e")) {
  console.error("mcp-smoke --e2e: not wired until C2")
  await client.close()
  process.exit(4)
}

await client.close()
process.exit(0)
