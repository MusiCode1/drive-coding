#!/usr/bin/env node
// mcp-smoke — real MCP client against a live drive-coding BE (slice session-bus-mcp).
//
//   node scripts/mcp-smoke.mjs --base http://127.0.0.1:<port>
//     initialize → tools/list → tools/call session_list
//
//   node scripts/mcp-smoke.mjs --base http://127.0.0.1:<port> --e2e
//     session_open(cursor) → session_send → text in response → session_close
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

if (!has("--e2e")) {
  await client.close()
  process.exit(0)
}

const nonce = Math.random().toString(36).slice(2, 8)
const cwd = String(get("--cwd", process.cwd()))
const timeoutSec = Number(get("--timeout", "180"))
const opened = await client.callTool({
  name: "session_open",
  arguments: {
    cli: "cursor",
    cwd,
    permission: "allow_always",
    publicUrl: base,
  },
})
if (opened.isError) {
  console.error("session_open error:", toolText(opened))
  await client.close()
  process.exit(1)
}
const openBody = JSON.parse(toolText(opened))
console.log(`opened agent=${openBody.agent} sessionId=${openBody.sessionId}`)
console.log(`url=${openBody.url}`)
const agent = openBody.agent
let failed = false
try {
  const prompt = `החזר OK-${nonce}`
  const sent = await client.callTool({
    name: "session_send",
    arguments: { agent, prompt, timeoutSec },
  })
  console.log("session_send:", toolText(sent))
  if (sent.isError) {
    console.error("session_send error")
    failed = true
  } else if (!toolText(sent).includes(`OK-${nonce}`)) {
    console.error(`nonce OK-${nonce} not in response`)
    failed = true
  } else {
    console.log(`nonce OK-${nonce} found`)
  }
} finally {
  const closed = await client.callTool({
    name: "session_close",
    arguments: { agent, force: true },
  })
  console.log("session_close:", toolText(closed))
  if (closed.isError) failed = true
}

await client.close()
process.exit(failed ? 1 : 0)
