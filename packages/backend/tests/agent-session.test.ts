import type { AcpTransport, PromptResponse, SessionNotification } from "@drive-coding/core"
import type { LogEntry } from "@drive-coding/core/log"
import { addSink, initLogger } from "@drive-coding/core/log"
import { describe, expect, it, vi } from "vitest"
import { createAgentSession } from "../src/app/agent-session"

// Silence pino output in tests
vi.spyOn(process.stdout, "write").mockReturnValue(true)
vi.spyOn(process.stderr, "write").mockReturnValue(true)

// Enable logger for all namespaces in tests
initLogger({ level: "trace", ns: "*", format: "json", remote: false })

function makeMockTransport(opts?: {
  onPrompt?: (text: string, onUpdate: (n: SessionNotification) => void) => Promise<PromptResponse>
  onCancel?: () => Promise<void>
  onShutdown?: () => Promise<void>
}): AcpTransport {
  return {
    async start(_input) {
      return { sessionId: "test-session-id", capabilities: { loadSession: false } }
    },
    async prompt(input, onUpdate) {
      if (opts?.onPrompt) return opts.onPrompt(input.text, onUpdate)
      return { stopReason: "end_turn" }
    },
    async cancel() {
      await opts?.onCancel?.()
    },
    async shutdown() {
      await opts?.onShutdown?.()
    },
  }
}

describe("AgentSession", () => {
  it("creates session with correct agentId", () => {
    const session = createAgentSession({
      agentId: "agent-42",
      transport: makeMockTransport(),
    })
    expect(session.agentId).toBe("agent-42")
  })

  it("subscribe + broadcast: sendPrompt broadcasts thinking then done", async () => {
    const transport = makeMockTransport()
    const session = createAgentSession({ agentId: "a", transport })

    const received: string[] = []
    session.subscribe((msg) => received.push(msg.type))

    await session.sendPrompt("hello")

    expect(received).toContain("thinking")
    expect(received).toContain("done")
    expect(received.indexOf("thinking")).toBeLessThan(received.indexOf("done"))
  })

  it("unsubscribe stops receiving messages", async () => {
    const transport = makeMockTransport()
    const session = createAgentSession({ agentId: "a", transport })

    const received: string[] = []
    const unsub = session.subscribe((msg) => received.push(msg.type))
    unsub() // unsubscribe before sending

    await session.sendPrompt("hello")

    expect(received).toHaveLength(0)
  })

  it("broadcasts text_chunk from agent_message_chunk notification", async () => {
    const transport = makeMockTransport({
      async onPrompt(_text, onUpdate) {
        onUpdate({
          sessionId: "s",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Hello from agent" },
            messageId: null,
          },
        })
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({ agentId: "a", transport })

    const chunks: string[] = []
    session.subscribe((msg) => {
      if (msg.type === "text_chunk") chunks.push(msg.text)
    })

    await session.sendPrompt("say hello")

    expect(chunks).toContain("Hello from agent")
  })

  it("broadcasts text_chunk with kind=thought from agent_thought_chunk notification", async () => {
    const transport = makeMockTransport({
      async onPrompt(_text, onUpdate) {
        onUpdate({
          sessionId: "s",
          update: {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: "Thinking about it..." },
            messageId: null,
          },
        })
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({ agentId: "a", transport })

    const thoughts: Array<{ kind: string; text: string }> = []
    session.subscribe((msg) => {
      if (msg.type === "text_chunk") thoughts.push({ kind: msg.kind, text: msg.text })
    })

    await session.sendPrompt("think please")

    expect(thoughts[0]).toEqual({ kind: "thought", text: "Thinking about it..." })
  })

  it("broadcasts tool_call from tool_call notification", async () => {
    const transport = makeMockTransport({
      async onPrompt(_text, onUpdate) {
        onUpdate({
          sessionId: "s",
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "tc-001",
            title: "Write file",
            content: [],
            status: "running",
          },
        })
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({ agentId: "a", transport })

    const toolCalls: Array<{ toolCallId: string; title: string }> = []
    session.subscribe((msg) => {
      if (msg.type === "tool_call") toolCalls.push({ toolCallId: msg.toolCallId, title: msg.title })
    })

    await session.sendPrompt("do something")

    expect(toolCalls[0]).toEqual({ toolCallId: "tc-001", title: "Write file" })
  })

  it("broadcasts error when prompt throws", async () => {
    const transport = makeMockTransport({
      async onPrompt() {
        throw new Error("connection lost")
      },
    })
    const session = createAgentSession({ agentId: "a", transport })

    const errors: Array<{ code: string; message: string }> = []
    session.subscribe((msg) => {
      if (msg.type === "error") errors.push({ code: msg.code, message: msg.message })
    })

    await session.sendPrompt("this will fail")

    expect(errors[0]?.code).toBe("PROMPT_FAILED")
    expect(errors[0]?.message).toContain("connection lost")
  })

  it("broadcasts done with correct stopReason", async () => {
    const transport = makeMockTransport({
      async onPrompt() {
        return { stopReason: "cancelled" }
      },
    })
    const session = createAgentSession({ agentId: "a", transport })

    const doneEvents: string[] = []
    session.subscribe((msg) => {
      if (msg.type === "done") doneEvents.push(msg.stopReason)
    })

    await session.sendPrompt("go")

    expect(doneEvents[0]).toBe("cancelled")
  })

  it("multiple subscribers all receive broadcast", async () => {
    const transport = makeMockTransport()
    const session = createAgentSession({ agentId: "a", transport })

    const receivedA: string[] = []
    const receivedB: string[] = []
    session.subscribe((msg) => receivedA.push(msg.type))
    session.subscribe((msg) => receivedB.push(msg.type))

    await session.sendPrompt("hi")

    expect(receivedA).toContain("thinking")
    expect(receivedA).toContain("done")
    expect(receivedB).toContain("thinking")
    expect(receivedB).toContain("done")
  })

  it("cancel calls transport.cancel", async () => {
    const cancelFn = vi.fn()
    const transport = makeMockTransport({ onCancel: cancelFn })
    const session = createAgentSession({ agentId: "a", transport })

    await session.cancel()

    expect(cancelFn).toHaveBeenCalledOnce()
  })

  it("shutdown calls transport.shutdown", async () => {
    const shutdownFn = vi.fn()
    const transport = makeMockTransport({ onShutdown: shutdownFn })
    const session = createAgentSession({ agentId: "a", transport })

    await session.shutdown()

    expect(shutdownFn).toHaveBeenCalledOnce()
  })
})

describe("AgentSession — PROMPT-1: busy flag (concurrent prompts)", () => {
  /** Covers behavior PROMPT-1: busy flag, no concurrent prompts */
  it("second concurrent sendPrompt receives BUSY error while first is in-flight", async () => {
    let resolveFirst: (r: PromptResponse) => void = () => {}
    const transport = makeMockTransport({
      async onPrompt() {
        return new Promise<PromptResponse>((resolve) => {
          resolveFirst = resolve
        })
      },
    })
    const session = createAgentSession({ agentId: "a", transport })

    const errors: Array<{ code: string }> = []
    session.subscribe((msg) => {
      if (msg.type === "error") errors.push({ code: msg.code })
    })

    // Start first prompt (fire-and-forget — transport.prompt will not resolve yet)
    // isBusy is set synchronously before the first await, so this is safe.
    const first = session.sendPrompt("first prompt")

    // Second prompt should detect busy and broadcast BUSY error immediately
    await session.sendPrompt("second prompt")

    // Finish the first
    resolveFirst({ stopReason: "end_turn" })
    await first

    expect(errors[0]?.code).toBe("BUSY")
  })

  it("after first sendPrompt completes, second sendPrompt succeeds", async () => {
    const transport = makeMockTransport()
    const session = createAgentSession({ agentId: "a", transport })

    await session.sendPrompt("first")
    // First completed — busy flag should be cleared

    const doneEvents: string[] = []
    session.subscribe((msg) => {
      if (msg.type === "done") doneEvents.push(msg.stopReason)
    })

    await session.sendPrompt("second")

    expect(doneEvents[0]).toBe("end_turn")
  })
})

describe("AgentSession — ACP-9: unknown sessionUpdate types silently ignored", () => {
  /** Covers behavior ACP-9: ignore plan / mode_update / config / session_info */
  it("unknown sessionUpdate type (plan) does not throw and does not broadcast text_chunk", async () => {
    const transport = makeMockTransport({
      async onPrompt(_text, onUpdate) {
        // Send an unknown sessionUpdate type (plan) — should be silently ignored
        const unknownNotif = {
          sessionId: "s",
          update: {
            sessionUpdate: "plan",
            payload: { step: 1 },
          },
        } as unknown as SessionNotification
        onUpdate(unknownNotif)
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({ agentId: "a", transport })

    const received: string[] = []
    session.subscribe((msg) => received.push(msg.type))

    await expect(session.sendPrompt("test")).resolves.toBeUndefined()

    // thinking + done should be present; text_chunk should NOT be from the unknown update
    expect(received).toContain("thinking")
    expect(received).toContain("done")
    expect(received.filter((t) => t === "text_chunk")).toHaveLength(0)
  })

  it("multiple unknown types (mode_update, config) in sequence — no crash", async () => {
    const transport = makeMockTransport({
      async onPrompt(_text, onUpdate) {
        for (const kind of ["mode_update", "config", "session_info", "usage"]) {
          onUpdate({
            sessionId: "s",
            update: { sessionUpdate: kind },
          } as unknown as SessionNotification)
        }
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({ agentId: "a", transport })

    // Must not throw
    await expect(session.sendPrompt("test")).resolves.toBeUndefined()
  })
})

describe("AgentSession — ACP-13: stopReason ≠ end_turn logs warning", () => {
  /** Covers behavior ACP-13: stopReason ≠ end_turn → log warning (via Logger sink), done still broadcast */

  it("stopReason=max_tokens → Logger.warn contains stopReason, done still broadcast", async () => {
    const warnEntries: LogEntry[] = []
    const removeSink = addSink((e) => {
      if (e.level === "warn") warnEntries.push(e)
    })

    const transport = makeMockTransport({
      async onPrompt() {
        return { stopReason: "max_tokens" }
      },
    })
    const session = createAgentSession({ agentId: "a", transport })

    const doneEvents: string[] = []
    session.subscribe((msg) => {
      if (msg.type === "done") doneEvents.push(msg.stopReason)
    })

    await session.sendPrompt("go")
    removeSink()

    expect(warnEntries.some((e) => String(e.fields?.stopReason).includes("max_tokens"))).toBe(true)
    expect(doneEvents[0]).toBe("max_tokens")
  })

  it("stopReason=end_turn → no warn log about stopReason", async () => {
    const warnEntries: LogEntry[] = []
    const removeSink = addSink((e) => {
      if (e.level === "warn" && String(e.fields?.stopReason).includes("end_turn"))
        warnEntries.push(e)
    })

    const transport = makeMockTransport()
    const session = createAgentSession({ agentId: "a", transport })

    await session.sendPrompt("go")
    removeSink()

    expect(warnEntries).toHaveLength(0)
  })
})
