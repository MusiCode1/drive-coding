export function inboundKind(input: {
  method: string
  connectionId?: string
  sessionId?: string
  rpcMethod?: string
}): "initialize" | "post" | "sse-connection" | "sse-session" | "delete" | "invalid" {
  const httpMethod = input.method.toUpperCase()

  if (httpMethod === "DELETE") {
    return "delete"
  }

  if (httpMethod === "GET") {
    if (!input.connectionId) {
      return "invalid"
    }
    if (input.sessionId) {
      return "sse-session"
    }
    return "sse-connection"
  }

  if (httpMethod === "POST") {
    if (!input.connectionId && input.rpcMethod === "initialize") {
      return "initialize"
    }
    if (input.connectionId) {
      return "post"
    }
    return "invalid"
  }

  return "invalid"
}

export function outboundSink(
  msg: unknown,
): "initialize-response" | "connection" | "session" {
  if (!msg || typeof msg !== "object") {
    return "connection"
  }

  const m = msg as Record<string, unknown>

  if ("method" in m && m.method === "session/update") {
    return "session"
  }

  if ("params" in m && m.params && typeof m.params === "object") {
    const params = m.params as Record<string, unknown>
    if ("sessionId" in params) {
      return "session"
    }
  }

  if ("result" in m && m.result && typeof m.result === "object") {
    const result = m.result as Record<string, unknown>
    if ("protocolVersion" in result) {
      return "initialize-response"
    }
    if ("stopReason" in result) {
      return "session"
    }
    if ("sessionId" in result) {
      return "connection"
    }
  }

  return "connection"
}
