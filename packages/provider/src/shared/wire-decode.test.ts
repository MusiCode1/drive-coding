import { describe, expect, it } from "vitest"
import { decodeWireLine } from "./wire-decode.js"

describe("decodeWireLine", () => {
  it("JSON-RPC request -> method + id", () => {
    const line = JSON.stringify({ jsonrpc: "2.0", method: "session/prompt", id: 1, params: {} })
    const result = decodeWireLine(line)
    expect(result.method).toBe("session/prompt")
    expect(result.id).toBe(1)
    expect(result.unparsed).toBe(false)
    expect(result.responseKind).toBeUndefined()
    expect(result.sessionUpdate).toBeUndefined()
  })

  it("JSON-RPC result response -> responseKind=result + id", () => {
    const line = JSON.stringify({ jsonrpc: "2.0", result: { ok: true }, id: 42 })
    const result = decodeWireLine(line)
    expect(result.responseKind).toBe("result")
    expect(result.id).toBe(42)
    expect(result.method).toBeUndefined()
    expect(result.unparsed).toBe(false)
  })

  it("JSON-RPC error response -> responseKind=error + id", () => {
    const line = JSON.stringify({ jsonrpc: "2.0", error: { code: -32600, message: "invalid" }, id: 7 })
    const result = decodeWireLine(line)
    expect(result.responseKind).toBe("error")
    expect(result.id).toBe(7)
    expect(result.unparsed).toBe(false)
  })

  it("ACP session/update notification -> sessionUpdate extracted from params.update", () => {
    const line = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: { update: { sessionUpdate: "agent_message_chunk", content: "hello" } },
    })
    const result = decodeWireLine(line)
    expect(result.sessionUpdate).toBe("agent_message_chunk")
    expect(result.method).toBe("session/update")
    expect(result.unparsed).toBe(false)
  })

  it("tool_call sessionUpdate extracted", () => {
    const line = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: { update: { sessionUpdate: "tool_call", toolName: "readFile" } },
    })
    const result = decodeWireLine(line)
    expect(result.sessionUpdate).toBe("tool_call")
  })

  it("invalid JSON -> unparsed:true, no throw", () => {
    const result = decodeWireLine("not valid json {{{")
    expect(result.unparsed).toBe(true)
    expect(result.method).toBeUndefined()
    expect(result.id).toBeUndefined()
    expect(result.parsed).toBeUndefined()
  })

  it("non-object JSON (e.g. number) -> unparsed:false, parsed set, no method", () => {
    const result = decodeWireLine("42")
    expect(result.unparsed).toBe(false)
    expect(result.parsed).toBe(42)
    expect(result.method).toBeUndefined()
    expect(result.id).toBeUndefined()
  })

  it("empty params/update -> no sessionUpdate, no throw", () => {
    const line = JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: {} })
    const result = decodeWireLine(line)
    expect(result.sessionUpdate).toBeUndefined()
    expect(result.method).toBe("session/update")
    expect(result.unparsed).toBe(false)
  })

  it("parsed object is preserved in summary.parsed", () => {
    const obj = { jsonrpc: "2.0", method: "initialize", id: "init-1", params: { clientInfo: { name: "test" } } }
    const line = JSON.stringify(obj)
    const result = decodeWireLine(line)
    expect(result.parsed).toEqual(obj)
    expect(result.method).toBe("initialize")
    expect(result.id).toBe("init-1")
  })
})
