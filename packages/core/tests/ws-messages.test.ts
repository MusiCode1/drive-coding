import { type } from "arktype"
import { describe, expect, it } from "vitest"
import {
  CancelMessage,
  ClientMessage,
  ConnectedMessage,
  DoneMessage,
  ErrorMessage,
  PingMessage,
  PromptMessage,
  ServerMessage,
  TextChunkMessage,
  ThinkingMessage,
  ToolCallMessage,
} from "../src/schemas/ws-messages"

// P1a regression: ToolLocation schema (decision 9) ───────────────────────────
describe("ToolCallMessage.locations — P1a drift fix (decision 9)", () => {
  it("accepts locations as array of {path, line} objects", () => {
    const result = ToolCallMessage({
      type: "tool_call",
      toolCallId: "tc-1",
      title: "Read file",
      locations: [{ path: "/src/index.ts", line: 42 }],
    })
    expect(result instanceof type.errors).toBe(false)
    if (!(result instanceof type.errors)) {
      expect(result.locations).toEqual([{ path: "/src/index.ts", line: 42 }])
    }
  })

  it("accepts locations with path only (line is optional)", () => {
    const result = ToolCallMessage({
      type: "tool_call",
      toolCallId: "tc-2",
      title: "Edit file",
      locations: [{ path: "/src/foo.ts" }],
    })
    expect(result instanceof type.errors).toBe(false)
    if (!(result instanceof type.errors)) {
      expect(result.locations).toEqual([{ path: "/src/foo.ts" }])
    }
  })

  it("accepts multiple locations", () => {
    const result = ToolCallMessage({
      type: "tool_call",
      toolCallId: "tc-3",
      title: "Search",
      locations: [
        { path: "/a.ts", line: 1 },
        { path: "/b.ts" },
      ],
    })
    expect(result instanceof type.errors).toBe(false)
  })

  it("rejects locations as plain string array (old drift format)", () => {
    const result = ToolCallMessage({
      type: "tool_call",
      toolCallId: "tc-4",
      title: "Bad format",
      locations: ["/src/index.ts"],
    })
    expect(result instanceof type.errors).toBe(true)
  })

  it("accepts tool_call without locations (optional)", () => {
    const result = ToolCallMessage({
      type: "tool_call",
      toolCallId: "tc-5",
      title: "No locations",
    })
    expect(result instanceof type.errors).toBe(false)
  })
})

describe("ClientMessage schemas (Slice 4)", () => {
  describe("PingMessage", () => {
    it("parses valid ping", () => {
      const result = PingMessage({ type: "ping" })
      expect(result instanceof type.errors).toBe(false)
      if (!(result instanceof type.errors)) {
        expect(result.type).toBe("ping")
      }
    })

    it("rejects wrong type string", () => {
      const result = PingMessage({ type: "pong" })
      expect(result instanceof type.errors).toBe(true)
    })
  })

  describe("PromptMessage", () => {
    it("parses valid prompt", () => {
      const result = PromptMessage({ type: "prompt", text: "Hello world" })
      expect(result instanceof type.errors).toBe(false)
      if (!(result instanceof type.errors)) {
        expect(result.text).toBe("Hello world")
      }
    })

    it("rejects empty text", () => {
      const result = PromptMessage({ type: "prompt", text: "" })
      expect(result instanceof type.errors).toBe(true)
    })

    it("rejects missing text", () => {
      const result = PromptMessage({ type: "prompt" })
      expect(result instanceof type.errors).toBe(true)
    })
  })

  describe("CancelMessage", () => {
    it("parses valid cancel", () => {
      const result = CancelMessage({ type: "cancel" })
      expect(result instanceof type.errors).toBe(false)
    })
  })

  describe("ClientMessage union", () => {
    it("accepts ping", () => {
      const result = ClientMessage({ type: "ping" })
      expect(result instanceof type.errors).toBe(false)
    })

    it("accepts prompt", () => {
      const result = ClientMessage({ type: "prompt", text: "hi" })
      expect(result instanceof type.errors).toBe(false)
    })

    it("accepts cancel", () => {
      const result = ClientMessage({ type: "cancel" })
      expect(result instanceof type.errors).toBe(false)
    })

    it("rejects unknown type", () => {
      const result = ClientMessage({ type: "unknown" })
      expect(result instanceof type.errors).toBe(true)
    })

    it("rejects non-object", () => {
      const result = ClientMessage("not an object")
      expect(result instanceof type.errors).toBe(true)
    })
  })
})

describe("ServerMessage schemas (Slice 4)", () => {
  describe("ConnectedMessage", () => {
    it("parses valid connected", () => {
      const result = ConnectedMessage({ type: "connected", agentId: "agent-123" })
      expect(result instanceof type.errors).toBe(false)
      if (!(result instanceof type.errors)) {
        expect(result.agentId).toBe("agent-123")
      }
    })

    it("rejects missing agentId", () => {
      const result = ConnectedMessage({ type: "connected" })
      expect(result instanceof type.errors).toBe(true)
    })
  })

  describe("ThinkingMessage", () => {
    it("parses valid thinking", () => {
      const result = ThinkingMessage({ type: "thinking" })
      expect(result instanceof type.errors).toBe(false)
    })
  })

  describe("TextChunkMessage", () => {
    it("parses message chunk", () => {
      const result = TextChunkMessage({ type: "text_chunk", kind: "message", text: "hello" })
      expect(result instanceof type.errors).toBe(false)
    })

    it("parses thought chunk", () => {
      const result = TextChunkMessage({ type: "text_chunk", kind: "thought", text: "thinking..." })
      expect(result instanceof type.errors).toBe(false)
    })

    it("rejects invalid kind", () => {
      const result = TextChunkMessage({ type: "text_chunk", kind: "invalid", text: "x" })
      expect(result instanceof type.errors).toBe(true)
    })
  })

  describe("ToolCallMessage", () => {
    it("parses valid tool_call", () => {
      const result = ToolCallMessage({ type: "tool_call", toolCallId: "tc-1", title: "Write file" })
      expect(result instanceof type.errors).toBe(false)
    })
  })

  describe("DoneMessage", () => {
    it("parses done with stop reason", () => {
      const result = DoneMessage({ type: "done", stopReason: "end_turn" })
      expect(result instanceof type.errors).toBe(false)
      if (!(result instanceof type.errors)) {
        expect(result.stopReason).toBe("end_turn")
      }
    })
  })

  describe("ErrorMessage", () => {
    it("parses valid error", () => {
      const result = ErrorMessage({ type: "error", code: "AGENT_NOT_FOUND", message: "id-123" })
      expect(result instanceof type.errors).toBe(false)
    })

    it("rejects missing code", () => {
      const result = ErrorMessage({ type: "error", message: "oops" })
      expect(result instanceof type.errors).toBe(true)
    })
  })

  describe("ServerMessage union", () => {
    it("accepts all server message types", () => {
      const msgs = [
        { type: "hello", version: "0.0.1" },
        { type: "pong", echoOf: "ping", serverTime: 1000 },
        { type: "connected", agentId: "a-1" },
        { type: "thinking" },
        { type: "text_chunk", kind: "message", text: "hi" },
        { type: "tool_call", toolCallId: "tc", title: "run" },
        { type: "done", stopReason: "end_turn" },
        { type: "error", code: "E", message: "m" },
      ]
      for (const msg of msgs) {
        const result = ServerMessage(msg)
        expect(result instanceof type.errors, `should accept: ${JSON.stringify(msg)}`).toBe(false)
      }
    })

    it("rejects unknown type", () => {
      const result = ServerMessage({ type: "unknown_type" })
      expect(result instanceof type.errors).toBe(true)
    })
  })
})
