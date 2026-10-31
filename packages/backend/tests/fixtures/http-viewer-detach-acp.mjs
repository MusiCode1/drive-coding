/** ACP fixture: only the matching JSON-RPC response completes the held prompt. */
let buf = ""
let pendingReply = null
let completions = 0
const mode = process.env.DC_FIXTURE_PENDING_KIND === "elicitation" ? "elicitation" : "permission"
const legacy = process.env.DC_FIXTURE_LEGACY_METHODS === "1"
const send = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`)

function handle(m) {
  // Responses never receive responses. Wrong ids/errors cannot complete a turn.
  if (m.method === undefined) {
    if (!pendingReply || m.id !== pendingReply.requestId || m.error || !m.result) return
    const valid =
      mode === "permission"
        ? m.result.outcome?.outcome === "selected" && m.result.outcome.optionId === "allow"
        : m.result.action === "accept" && m.result.content?.answer === "yes"
    if (!valid) return
    const held = pendingReply
    pendingReply = null
    completions++
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: held.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: `done: pid=${process.pid} completions=${completions} reply=${JSON.stringify(m.result)}`,
          },
        },
      },
    })
    send({ jsonrpc: "2.0", id: held.promptId, result: { stopReason: "end_turn" } })
    return
  }
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
  } else if (m.method === "session/prompt" && !pendingReply) {
    const sessionId = m.params.sessionId
    const requestId = 7001
    pendingReply = { promptId: m.id, sessionId, requestId }
    const method = mode === "permission" ? "session/request_permission" : "elicitation/create"
    send({
      jsonrpc: "2.0",
      id: requestId,
      method: legacy
        ? mode === "permission"
          ? "client/session/request_permission"
          : "client/session/create_elicitation"
        : method,
      params:
        mode === "permission"
          ? {
              sessionId,
              toolCall: { toolCallId: "t1", title: "Tool", status: "pending" },
              options: [{ optionId: "allow", kind: "allow_once", name: "Allow" }],
            }
          : {
              sessionId,
              mode: "form",
              message: "Need input",
              requestedSchema: { type: "object", properties: { answer: { type: "string" } } },
            },
    })
  } else if (m.id !== undefined) {
    send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "Method not found" } })
  }
}
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  buf += chunk
  let nl = buf.indexOf("\n")
  while (nl !== -1) {
    const line = buf.slice(0, nl)
    buf = buf.slice(nl + 1)
    if (line.trim()) handle(JSON.parse(line))
    nl = buf.indexOf("\n")
  }
})
process.stdin.on("end", () => process.exit(0))
