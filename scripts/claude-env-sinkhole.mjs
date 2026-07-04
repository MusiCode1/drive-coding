// claude-env-sinkhole.mjs — fake Anthropic endpoint for mechanism-gate (§8b).
// Proves that ANTHROPIC_BASE_URL injected via cli-spec reaches the claude child process:
// if a request lands here — the injection works. No forwarding; no valid response needed.
//
// Usage:
//   node scripts/claude-env-sinkhole.mjs
//   # In another terminal, set CLI_SPECS_FILE to a temp jsonc with:
//   #   { "claude": { "setEnv": { "ANTHROPIC_BASE_URL": "http://127.0.0.1:9999" } } }
//   # Then start BE (without OneCLI) and open a claude session from the FE.
//   # HIT in stdout = injection confirmed.
//
// Environment:
//   SINK_PORT — port to listen on (default: 9999)

import { createServer } from "node:http"

const port = Number(process.env.SINK_PORT ?? 9999)
let hits = 0

createServer((req, res) => {
  console.log(`HIT #${++hits}`, req.method, req.url, "host:", req.headers.host)
  res.writeHead(401, { "content-type": "application/json" })
  res.end('{"error":"sinkhole"}')
}).listen(port, "127.0.0.1", () => {
  console.log(`sinkhole listening on http://127.0.0.1:${port}`)
  console.log("Waiting for claude child to call ANTHROPIC_BASE_URL...")
})
