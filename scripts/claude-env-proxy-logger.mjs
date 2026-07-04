// claude-env-proxy-logger.mjs — logging CONNECT proxy for mechanism-gate variant B (§8b).
// Logs CONNECT requests (e.g. api.anthropic.com:443) and tunnels them through.
// Proves HTTPS_PROXY injected via cli-spec reaches the claude child process.
// Variant B — more faithful to proxy routing; variant A (sinkhole) is sufficient for gate.
//
// Usage:
//   node scripts/claude-env-proxy-logger.mjs
//   # In another terminal, set CLI_SPECS_FILE to a temp jsonc with:
//   #   { "claude": { "setEnv": { "HTTPS_PROXY": "http://127.0.0.1:9999" } } }
//   # Then start BE and open a claude session. CONNECT api.anthropic.com:443 in stdout = GO.
//
// Environment:
//   PROXY_PORT — port to listen on (default: 9999)

import { createServer } from "node:http"
import { connect } from "node:net"

const port = Number(process.env.PROXY_PORT ?? 9999)

const srv = createServer((_req, res) => {
  res.writeHead(405)
  res.end()
})

srv.on("connect", (req, client, head) => {
  console.log("CONNECT", req.url)
  const [host, p] = (req.url ?? "").split(":")
  const upstream = connect(Number(p) || 443, host ?? "", () => {
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n")
    upstream.write(head)
    upstream.pipe(client)
    client.pipe(upstream)
  })
  upstream.on("error", () => client.end())
})

srv.listen(port, "127.0.0.1", () => {
  console.log(`proxy-logger listening on http://127.0.0.1:${port}`)
  console.log("Waiting for claude child CONNECT tunnel...")
})
