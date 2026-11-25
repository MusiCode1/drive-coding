// Offline ACP v1 fixture for switching, creating and deleting sessions in the browser.
import { appendFileSync } from "node:fs"
import { createInterface } from "node:readline"

const traceFile = process.env.CONTRACT2_FIXTURE_TRACE
const canDelete = process.cwd().split("/").at(-1) !== "no-delete"
const primary = "fixture-primary"
const secondary = "fixture-secondary"
const notesConfig = {
  id: "fixture-persona-id",
  name: "Agent",
  type: "select",
  currentValue: "builder",
  options: [
    { value: "builder", name: "Builder" },
    { value: "reviewer", name: "Reviewer" },
  ],
}
const sessions = new Set([primary, secondary])
let opened = 0

function trace(method, params) {
  if (traceFile) {
    appendFileSync(traceFile, `${JSON.stringify({ pid: process.pid, method, params })}\n`)
  }
}

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`)
}

process.on("exit", () => trace("exit"))
const input = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY })
for await (const line of input) {
  const { id, method, params } = JSON.parse(line)
  if (typeof method !== "string") continue
  trace(method, params)
  let result = {}
  switch (method) {
    case "initialize":
      result = {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          sessionCapabilities: { list: {}, ...(canDelete ? { delete: {} } : {}) },
        },
        authMethods: [],
      }
      break
    case "session/new": {
      const sessionId = opened++ === 0 ? primary : `fixture-new-${opened}`
      sessions.add(sessionId)
      result = { sessionId, configOptions: [notesConfig] }
      break
    }
    case "session/load":
      opened = Math.max(opened, 1)
      sessions.add(params.sessionId)
      result = { configOptions: [notesConfig] }
      break
    case "session/list":
      result = {
        sessions: [...sessions].map((sessionId) => ({
          sessionId,
          cwd: params?.cwd ?? process.cwd(),
          title: sessionId,
          updatedAt: "2026-01-01T00:00:00.000Z",
        })),
      }
      break
    case "session/delete":
      if (canDelete) sessions.delete(params.sessionId)
      else {
        send({ id, error: { code: -32601, message: "Method not available" } })
        continue
      }
      break
    case "session/set_config_option":
      notesConfig.currentValue = params.value
      result = { configOptions: [notesConfig] }
      break
    case "session/prompt":
      send({
        method: "session/update",
        params: {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "FIXTURE-REPLY" },
          },
        },
      })
      result = { stopReason: "end_turn" }
      break
    default:
      break
  }
  if (id !== undefined) send({ id, result })
}
