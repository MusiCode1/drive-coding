import { createInterface } from "node:readline"

const sessionId = "b1-fixture-session"
const replyText = "B1 fixture reply"
const reasons = new Set(["end_turn", "cancelled", "refusal", "max_tokens", "max_turn_requests"])
const pending = new Map()
const replacedReason = process.env.B1_FIXTURE_REPLACE_REASON

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`)
}

function chunk(sessionId, text) {
  send({
    method: "session/update",
    params: {
      sessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
    },
  })
}

function complete(request, stopReason) {
  pending.delete(request.params.sessionId)
  send({
    id: request.id,
    result: { stopReason: stopReason === replacedReason ? "end_turn" : stopReason },
  })
}

function prompt(request) {
  const promptText = request.params.prompt
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
  const scenario = /\[b1:([\w-]+)\]/.exec(promptText)?.[1] ?? "end_turn"
  chunk(request.params.sessionId, replyText)
  if (scenario === "reject") {
    send({ id: request.id, error: { code: -32001, message: "Fixture prompt rejected" } })
  } else if (
    scenario === "cancelled" ||
    scenario === "hold" ||
    scenario === "late-cancel" ||
    scenario === "held-refusal"
  ) {
    pending.set(request.params.sessionId, { request, scenario })
  } else {
    complete(request, reasons.has(scenario) ? scenario : "end_turn")
  }
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
input.on("line", (line) => {
  if (line.trim() === "") return
  const message = JSON.parse(line)
  switch (message.method) {
    case "initialize":
      send({
        id: message.id,
        result: {
          protocolVersion: 1,
          agentCapabilities: { loadSession: true },
          authMethods: [],
        },
      })
      break
    case "session/new":
      send({ id: message.id, result: { sessionId } })
      break
    case "session/load":
      send({ id: message.id, result: {} })
      break
    case "session/prompt":
      prompt(message)
      break
    case "session/cancel": {
      const turn = pending.get(message.params.sessionId)
      if (turn?.scenario === "cancelled") complete(turn.request, "cancelled")
      break
    }
    case "_test/complete": {
      const turn = pending.get(message.params.sessionId)
      if (
        turn?.scenario === "late-cancel" ||
        (turn?.scenario === "held-refusal" && message.params.tail)
      ) {
        chunk(message.params.sessionId, " after local cancel")
      }
      if (turn) complete(turn.request, turn.scenario === "held-refusal" ? "refusal" : "end_turn")
      break
    }
    default:
      if (message.id !== undefined) {
        send({ id: message.id, error: { code: -32601, message: "Method not found" } })
      }
  }
})
