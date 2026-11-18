/**
 * fake-acp-agent.mjs — the smallest thing that is really an ACP agent.
 *
 * Enough of the protocol for a session host to initialize, open a session and
 * run a turn: `initialize`, `session/new`, `session/prompt` (which streams one
 * chunk and ends the turn), plus `_test/exit`. Deterministic and offline, so a
 * test can assert on exact text without a model in the loop.
 */
let buf = ""
const send = (o) => process.stdout.write(`${JSON.stringify(o)}\n`)

process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  buf += chunk
  let nl = buf.indexOf("\n")
  while (nl !== -1) {
    const line = buf.slice(0, nl)
    buf = buf.slice(nl + 1)
    nl = buf.indexOf("\n")
    if (line.trim() === "") continue
    let m
    try {
      m = JSON.parse(line)
    } catch {
      continue
    }
    if (m.method === "_test/exit") process.exit(0)
    if (m.method === "initialize") {
      send({
        jsonrpc: "2.0",
        id: m.id,
        result: {
          protocolVersion: 1,
          agentCapabilities: { loadSession: true, promptCapabilities: { image: false } },
          authMethods: [],
        },
      })
    } else if (m.method === "session/new") {
      send({ jsonrpc: "2.0", id: m.id, result: { sessionId: "fixture-session-1" } })
    } else if (m.method === "session/load") {
      send({ jsonrpc: "2.0", id: m.id, result: {} })
    } else if (m.method === "session/prompt") {
      send({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: m.params?.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "FIXTURE-REPLY" },
          },
        },
      })
      send({ jsonrpc: "2.0", id: m.id, result: { stopReason: "end_turn" } })
    } else if (m.id !== undefined) {
      send({ jsonrpc: "2.0", id: m.id, result: {} })
    }
  }
})
process.stdin.on("end", () => process.exit(0))
