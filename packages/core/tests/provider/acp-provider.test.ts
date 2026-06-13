/**
 * acp-provider.test.ts — AcpProviderSession מול MockAcpTransport (P1b/Commit 2).
 *
 * דפוס נהיגת הפרוטוקול זהה ל-client.test.ts: בונים transport, מתחילים,
 * ממתינים ל-frame שה-SDK כותב, ומזריקים תגובה תואמת.
 */
import { describe, expect, test } from "vitest"
import { MockAcpTransport } from "../../src/acp/transport-mock.js"
import { AcpProviderSession } from "../../src/provider/acp-provider.js"
import type { ProviderEvent } from "../../src/provider/events.js"

// משחרר microtasks כדי שקורא ה-stream של ה-SDK יעבד כתיבות ממתינות.
async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise<void>((r) => setTimeout(r, 0))
  }
}

function makeInitResponse(id: number): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    result: {
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { audio: false, image: true, embeddedContext: false },
        sessionCapabilities: { list: {}, resume: {} },
      },
      authMethods: [],
    },
  })
}

function makeResult(id: number, result: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, result })
}

function lastFrame(transport: MockAcpTransport, method: string): { id: number; method: string } {
  for (let i = transport.sentFrames.length - 1; i >= 0; i--) {
    const f = JSON.parse(transport.sentFrames[i] ?? "") as { id: number; method: string }
    if (f.method === method) return f
  }
  throw new Error(`no frame for method=${method}`)
}

async function startSession(): Promise<{
  transport: MockAcpTransport
  session: AcpProviderSession
  events: ProviderEvent[]
}> {
  const transport = new MockAcpTransport()
  const events: ProviderEvent[] = []
  const session = new AcpProviderSession({ transport, cwd: "/tmp/x", initTimeoutMs: 200 })
  session.onEvent((e) => events.push(e))

  const startP = session.start({ fs: false, terminal: false, permissions: true })
  await flush()
  const initReq = lastFrame(transport, "initialize")
  transport.emitFrame(makeInitResponse(initReq.id))
  await flush()
  const newReq = lastFrame(transport, "session/new")
  transport.emitFrame(makeResult(newReq.id, { sessionId: "sess-1" }))
  await startP

  return { transport, session, events }
}

describe("AcpProviderSession — start", () => {
  test("start → session.ready עם sessionId + capabilities", async () => {
    const { session, events } = await startSession()
    expect(session.sessionId).toBe("sess-1")
    expect(session.providerId).toBe("acp")
    const ready = events.find((e) => e.type === "session.ready")
    expect(ready).toBeDefined()
    expect(ready).toMatchObject({ type: "session.ready", sessionId: "sess-1" })
    expect((ready as { capabilities: unknown }).capabilities).toBe(session.capabilities)
  })
})

describe("AcpProviderSession — sendPrompt (async, non-blocking)", () => {
  test("מחזיר PromptAck מיד (לפני שה-turn מסתיים)", async () => {
    const { transport, session } = await startSession()
    // ה-ack חוזר בלי להמתין ל-turn — אם היה חוסם, ה-await היה תקוע (לא הזרקנו עדיין תגובה)
    const ack = await session.sendPrompt("hello")
    expect(ack.status).toBe("running")
    expect(typeof ack.turnId).toBe("string")
    expect(ack.turnId.length).toBeGreaterThan(0)
    await flush()
    const promptReq = lastFrame(transport, "session/prompt")
    expect(promptReq).toBeDefined()
  })

  test("turn.end נפלט כש-prompt resolves, עם turnId תואם + isError=false ל-end_turn", async () => {
    const { transport, session, events } = await startSession()
    const ack = await session.sendPrompt("hello")
    await flush()
    const promptReq = lastFrame(transport, "session/prompt")
    transport.emitFrame(makeResult(promptReq.id, { stopReason: "end_turn" }))
    await flush()
    const turnEnd = events.find((e) => e.type === "turn.end")
    expect(turnEnd).toEqual({
      type: "turn.end",
      turnId: ack.turnId,
      stopReason: "end_turn",
      isError: false,
    })
  })

  test("isError=true ל-stopReason='refusal'", async () => {
    const { transport, session, events } = await startSession()
    const ack = await session.sendPrompt("hi")
    await flush()
    const promptReq = lastFrame(transport, "session/prompt")
    transport.emitFrame(makeResult(promptReq.id, { stopReason: "refusal" }))
    await flush()
    expect(events.find((e) => e.type === "turn.end")).toEqual({
      type: "turn.end",
      turnId: ack.turnId,
      stopReason: "refusal",
      isError: true,
    })
  })

  test("PromptContent כמערך → חילוץ text מחלקי text בלבד", async () => {
    const { transport, session } = await startSession()
    await session.sendPrompt([
      { type: "text", text: "a" },
      { type: "image", data: "x", mimeType: "image/png" },
      { type: "text", text: "b" },
    ])
    await flush()
    const promptReq = lastFrame(transport, "session/prompt") as unknown as {
      params: { prompt: Array<{ type: string; text: string }> }
    }
    expect(promptReq.params.prompt).toEqual([{ type: "text", text: "ab" }])
  })
})

describe("AcpProviderSession — cancel / stop", () => {
  test("cancel → session/cancel ל-sessionId", async () => {
    const { transport, session } = await startSession()
    await session.cancel()
    await flush()
    const frame = lastFrame(transport, "session/cancel") as unknown as {
      params: { sessionId: string }
    }
    expect(frame.params.sessionId).toBe("sess-1")
  })

  test("stop → סוגר את ה-transport", async () => {
    const { transport, session } = await startSession()
    let closed = false
    transport.onClose(() => {
      closed = true
    })
    await session.stop()
    expect(closed).toBe(true)
  })
})

describe("AcpProviderSession — onEvent forwarding", () => {
  test("session/update notification → ProviderEvent דרך mapAcpNotification", async () => {
    const { transport, events } = await startSession()
    transport.emitFrame(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "sess-1",
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } },
        },
      }),
    )
    await flush()
    expect(events).toContainEqual({ type: "message.delta", role: "assistant", text: "hi" })
  })

  test("unsubscribe מפסיק forwarding", async () => {
    const { transport, session, events } = await startSession()
    const before = events.length
    // onEvent מחליף handler; קריאה חוזרת עם unsubscribe מאפסת
    const unsub = session.onEvent(() => {})
    unsub()
    transport.emitFrame(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "sess-1",
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "x" } },
        },
      }),
    )
    await flush()
    expect(events.length).toBe(before)
  })
})

describe("AcpProviderSession — tier 2", () => {
  test("listSessions → client.listSessions().sessions", async () => {
    const { transport, session } = await startSession()
    const p = session.listSessions?.()
    await flush()
    const req = lastFrame(transport, "session/list")
    transport.emitFrame(makeResult(req.id, { sessions: [{ sessionId: "a" }, { sessionId: "b" }] }))
    const sessions = await p
    expect(sessions).toEqual([{ sessionId: "a" }, { sessionId: "b" }])
  })

  test("resumeSession → session/load ל-id", async () => {
    const { transport, session } = await startSession()
    const p = session.resumeSession?.("sess-old")
    await flush()
    const req = lastFrame(transport, "session/load") as unknown as {
      params: { sessionId: string; cwd: string }
    }
    expect(req.params.sessionId).toBe("sess-old")
    expect(req.params.cwd).toBe("/tmp/x")
    transport.emitFrame(makeResult((req as unknown as { id: number }).id, {}))
    await p
  })
})
