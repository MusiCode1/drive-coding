/**
 * fake-acp-cli.mjs — a stand-in CLI for sidecar tests.
 *
 * Speaks the only thing the sidecar cares about: NDJSON in, NDJSON out. Every
 * request gets a response echoing its method, so a test can prove a frame made
 * the full round trip through the socket, the sidecar and back.
 */
let buf = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  buf += chunk
  let nl = buf.indexOf("\n")
  while (nl !== -1) {
    const line = buf.slice(0, nl)
    buf = buf.slice(nl + 1)
    if (line.trim() !== "") {
      try {
        const msg = JSON.parse(line)
        // Test hook: the only way to end this fixture from the outside. Closing
        // the socket must NOT do it — surviving that is the point of a sidecar.
        if (msg.method === "_test/exit") process.exit(0)
        process.stdout.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { echo: msg.method } })}\n`,
        )
      } catch {
        process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", error: "bad json" })}\n`)
      }
    }
    nl = buf.indexOf("\n")
  }
})
process.stdin.on("end", () => process.exit(0))
