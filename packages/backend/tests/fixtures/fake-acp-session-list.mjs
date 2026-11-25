import { createInterface } from "node:readline"

const options = JSON.parse(process.env.SESSION_LIST_FIXTURE_OPTIONS ?? "{}")
const cursor = "  second/+?=☃  "
let initialized = false
const sessions = new Set()
const lines = createInterface({ input: process.stdin })

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`)
}

function reject(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`)
}

for await (const line of lines) {
  const { id, method, params } = JSON.parse(line)
  if (id === undefined) continue
  if (method === "initialize") {
    if (initialized) {
      reject(id, -32600, "already initialized")
      continue
    }
    initialized = true
    reply(id, {
      protocolVersion: 1,
      agentCapabilities: options.agentCapabilities ?? {
        sessionCapabilities: { list: {}, delete: {} },
      },
    })
    continue
  }
  if (!initialized) {
    reject(id, -32600, "initialize first")
    continue
  }
  switch (method) {
    case "session/new": {
      const sessionId = sessions.size === 0 ? "fixture-saved" : "fixture-new"
      sessions.add(sessionId)
      reply(id, { sessionId })
      break
    }
    case "session/load":
      if (options.failLoad || !sessions.has(params.sessionId)) {
        reject(id, -32602, "fixture cannot load this session")
      } else reply(id, {})
      break
    case "session/list": {
      if (options.listError) {
        reject(id, options.listError, "fixture list rejected")
        break
      }
      const cwd = params.cwd ?? "/fixture/all"
      if (params.cursor === undefined) {
        reply(id, {
          sessions: [{ sessionId: "first", cwd }],
          nextCursor: options.emptyCursor ? "" : cursor,
        })
        break
      }
      if (params.cursor === cursor || (options.emptyCursor && params.cursor === "")) {
        reply(id, {
          sessions: [{ sessionId: "second", cwd }],
          ...(options.nullEnd && { nextCursor: null }),
        })
        break
      }
      reject(id, -32602, "fixture rejected cursor")
      break
    }
    case "session/delete":
      if (options.deleteError) reject(id, options.deleteError, "fixture delete rejected")
      else reply(id, {})
      break
    default:
      reject(id, -32601, "fixture does not support this method")
  }
}
