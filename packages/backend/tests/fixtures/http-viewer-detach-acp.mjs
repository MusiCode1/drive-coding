/**
 * http-viewer-detach-acp.mjs — holds permission/elicitation until matching client reply.
 * Used by http-viewer-detach integration tests (no personal data).
 */
let buf = ""
let pendingReply = null
const mode = process.env.DC_FIXTURE_PENDING_KIND === "elicitation" ? "elicitation" : "permission"

const send = (o) => process.stdout.write(`${JSON.stringify(o)}\n`)

function finishPrompt(id, sessionId) {
  send({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "done" } },
    },
  })
  send({ jsonrpc: "2.0", id, result: { stopReason: "end_turn" } })
}

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
      const sessionId = m.params?.sessionId ?? "fixture-session-1"
      const reqId = mode === "permission" ? 0 : 1
      pendingReply = { promptId: m.id, sessionId }
      if (mode === "permission") {
        send({
          jsonrpc: "2.0",
          method: "client/session/request_permission",
          params: {
            sessionId,
            toolCall: { toolCallId: "t1", title: "Tool", status: "pending" },
            options: [{ optionId: "allow", kind: "allow_once", name: "Allow" }],
          },
          id: reqId,
        })
      } else {
        send({
          jsonrpc: "2.0",
          method: "client/session/create_elicitation",
          params: {
            sessionId,
            message: "Need input",
            requestedSchema: { type: "object", properties: {} },
          },
          id: reqId,
        })
      }
    } else if (
      m.id !== undefined &&
      pendingReply &&
      (m.result?.outcome || m.result?.action || m.error)
    ) {
      finishPrompt(pendingReply.promptId, pendingReply.sessionId)
      pendingReply = null
      send({ jsonrpc: "2.0", id: m.id, result: {} })
    } else if (m.id !== undefined) {
      send({ jsonrpc: "2.0", id: m.id, result: {} })
    }
  }
})
process.stdin.on("end", () => process.exit(0))
