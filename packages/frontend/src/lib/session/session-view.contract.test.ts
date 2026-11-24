/**
 * session-view.contract.test.ts — מריץ את session-view-contract על local, HTTP/SSE ו-WebSocket.
 *
 * Testing: tdd (brief §C1)
 *
 * local  — LocalSessionView עם mock AcpClient (createClient מוזרק).
 * remote — RemoteSessionView עם fake SSE או WS. ⚠️ ה-harness מריץ `reduce`/`applyPendingRequest`/
 *          `clearPendingRequest`/`applyTurnEnd` מ-core (לא patches ידניים) — כדי שהתנהגות 3
 *          תבדוק את ה-view, לא את ה-harness. אותם פריימים מפוענחים ב-FrameReader.
 *
 * + טבלת-הסטייה (session management, PromptBlocks, RPC failure, respond id לא-מוכר).
 *
 * ─── slice view-switch C1 (TDD) ───
 */

import type { SessionNotification } from "@agentclientprotocol/sdk"
import {
  applyPendingRequest,
  applyTurnEnd,
  type ChannelResponse,
  clearPendingRequest,
  createInitialSessionState,
  decodeWsClientMessage,
  encodeWsControl,
  encodeWsFrame,
  encodeWsServerResponse,
  type Patch,
  type PendingKind,
  RPC_METHODS,
  reduce,
  type SessionState,
  type SseFrame,
  serializeFrame,
  snapshotFrame,
  type ToolOutput,
  type ToolOutputRules,
  updateFrame,
} from "@drive-coding/core/session"
import type { AcpClient } from "@drive-coding/provider/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { fakeSessionSockets } from "./__contract__/fake-session-socket"
import {
  type ContractHarness,
  describeSessionViewContract,
  PatchBuffer,
} from "./__contract__/session-view-contract.js"
import { createRemoteView } from "./create-session-view.js"
import { LocalSessionView } from "./local-session-view.js"
import type { RemoteSessionView } from "./remote-session-view.js"
import type { SessionTransport } from "./session-transport"
import type { RpcKind } from "./wire/pipe"

// ⚠️ `AcpClientCallbacks` אינו re-exported מ-"@drive-coding/provider/client" (פער קיים,
// לא בהיקף ה-slice — משפיע כבר על local-session-view.ts/test.ts). נגזר structurally
// מחתימת ה-constructor במקום לייבא את הסמל השבור (מונע DELTA-CHECK חדש).
type CapturedCallbacks = Parameters<
  NonNullable<ConstructorParameters<typeof LocalSessionView>[0]["createClient"]>
>[0]

// ── local harness ──────────────────────────────────────────────────────────────

function createMockAcpClient(outboundLog: Array<{ method: string; params: unknown }>): AcpClient {
  return {
    newSession: vi.fn().mockResolvedValue({ sessionId: "s-contract" }),
    loadSession: vi.fn().mockResolvedValue({}),
    // ⚠️ התוויות כאן קנוניות **בכוונה**, ולא "כדי שהטסט יעבור". ה-harness
    // המרוחק דוחף את גוף-החוט האמיתי; המקומי דוחף תווית מסונתזת. אם השתיים
    // אינן מדברות אותו אוצר-מילים, כל קיבוע ב-contract המשותף נעשה
    // תלוי-תעבורה — וזה בדיוק מה ש-contract משותף אמור למנוע.
    // וזו גם התווית הנכונה: החוט-לספק במסלול המקומי **הוא** session/prompt.
    prompt: vi.fn(async (sessionId: string, content: unknown) => {
      outboundLog.push({ method: RPC_METHODS.prompt, params: { sessionId, content } })
    }),
    cancel: vi.fn(async (sessionId: string) => {
      outboundLog.push({ method: RPC_METHODS.cancel, params: { sessionId } })
    }),
    extMethod: vi.fn().mockResolvedValue({ snapshot: null }),
    listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    setSessionConfigOption: vi.fn().mockResolvedValue({ configOptions: [] }),
    setSessionMode: vi.fn().mockResolvedValue(undefined),
    setSessionModel: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    conn: {} as AcpClient["conn"],
    capabilities: {} as AcpClient["capabilities"],
    authMethods: [],
  } as unknown as AcpClient
}

async function createLocalHarness(): Promise<ContractHarness> {
  const outboundLog: Array<{ method: string; params: unknown }> = []
  const client = createMockAcpClient(outboundLog)
  let cbs: CapturedCallbacks | null = null
  const view = new LocalSessionView({
    cwd: "/workspace",
    cliKind: "claude",
    createClient: async (c) => {
      cbs = c
      return client
    },
  })
  // ⚠️ חובה — LocalSessionView בונה את ה-client/callbacks רק כאן (brief §C1)
  await view.newSession()
  if (!cbs) throw new Error("createLocalHarness: newSession() did not invoke createClient")
  const boundCbs = cbs as CapturedCallbacks

  const pb = new PatchBuffer(view.patches)

  return {
    view,
    nextPatches: (n) => pb.nextPatches(n),
    async emitUpdate(update) {
      const target = pb.totalPushed + 1
      boundCbs.onUpdate({ sessionId: "s-contract", update } as SessionNotification)
      await pb.waitForTotalAtLeast(target)
    },
    async emitPermission(params) {
      // ⚠️ local: אסור await על onRequestPermission — הוא נפתר רק כש-respond() נקרא (deadlock).
      void boundCbs.onRequestPermission?.(params as never)
      await Promise.resolve()
      const requestId = view.state.pending.permission?.requestId
      if (requestId === undefined) throw new Error("emitPermission: pending.permission not set")
      return requestId
    },
    async settle() {
      // local: כתיבה סינכרונית — אין מה להמתין לו.
    },
    outbound: () => outboundLog,
    async dispose() {
      await pb.dispose()
      await view.close().catch(() => {})
    },
  }
}

// ── remote harness ─────────────────────────────────────────────────────────────

function makeLiveSSEBody(): {
  body: ReadableStream<Uint8Array>
  pushRaw: (frame: SseFrame) => void
  close: () => void
} {
  const encoder = new TextEncoder()
  let ctrl!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start: (c) => {
      ctrl = c
    },
  })
  return {
    body,
    close: () => ctrl.close(),
    // ⚠️ המסגור נעשה ע"י הקורא, לא כאן. ה-harness הוא היחיד שמחזיק את
    // ה-shadowState — וה-state נדרש כדי למפות patch ל-`session/update`
    // (‏`append-segment` נושא `targetId` בלבד, והסוג נגזר מה-role של היעד).
    pushRaw: (frame) => {
      ctrl.enqueue(encoder.encode(serializeFrame(frame)))
    },
  }
}

type HandleRequest = (kind: RpcKind, body: unknown) => ChannelResponse
type FrameTransform = (frame: SseFrame) => SseFrame

async function connectRemoteHarness(
  transport: SessionTransport,
  snapshot: SessionState,
  handleRequest: HandleRequest,
  transformWsFrame: FrameTransform = (frame) => frame,
) {
  const initialFrame = snapshotFrame(snapshot)
  const base = { agentId: "agent-contract", baseUrl: "http://be.local", transport }
  if (transport === "ws") {
    const sockets = fakeSessionSockets()
    const connected = createRemoteView({ ...base, _WebSocket: sockets.WebSocket })
    const socket = sockets.latest()
    const send = socket.send.bind(socket)
    vi.spyOn(socket, "send").mockImplementation((data) => {
      send(data)
      const message = decodeWsClientMessage(data)
      if (!message) throw new Error("Malformed WS client message")
      if (message.kind === "ping") socket.receive(encodeWsControl("$/pong"))
      if (message.kind !== "request") return
      const { id, method, params } = message.request
      const reply = handleRequest(method === "_drive/rpc" ? "rpc" : "reply", params)
      socket.receive(encodeWsServerResponse(id, reply))
    })
    const pushRaw = (frame: SseFrame) => socket.receive(encodeWsFrame(transformWsFrame(frame)))
    socket.connect()
    pushRaw(initialFrame)
    return { view: await connected, pushRaw }
  }

  const sse = makeLiveSSEBody()
  const view = await createRemoteView({
    ...base,
    async _fetch(url, init) {
      if (url.endsWith("/events")) {
        sse.pushRaw(initialFrame)
        init?.signal?.addEventListener("abort", sse.close, { once: true })
        return new Response(sse.body)
      }
      const raw: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined
      if (!url.endsWith("/rpc") && !url.endsWith("/reply")) throw new Error("Unexpected RPC URL")
      const response = handleRequest(url.endsWith("/rpc") ? "rpc" : "reply", raw)
      return Response.json(response.body, { status: response.status })
    },
  })
  return { view, pushRaw: sse.pushRaw }
}

async function createRemoteHarness(transport: SessionTransport): Promise<ContractHarness> {
  const outboundLog: Array<{ method: string; params: unknown }> = []
  // The fixture folds the same updates as the host so each frame carries the right version.
  let shadowState = createInitialSessionState({ sessionId: "sess-contract" })
  let nextRequestId = 0
  const { view, pushRaw } = await connectRemoteHarness(transport, shadowState, (kind, body) => {
    if (kind === "reply") {
      outboundLog.push({ method: "reply", params: body })
      return { status: 200, body: { ok: true } }
    }
    outboundLog.push(body as { method: string; params: unknown })
    return { status: 202, body: { version: shadowState.version } }
  })

  const pb = new PatchBuffer(view.patches)

  /** דוחף patches (frame-per-patch — כמו production) וממתין שיוחלו, בלי לצרוך מה-buffer. */
  async function pushAndWait(patches: Patch[]): Promise<void> {
    if (patches.length === 0) return
    const target = pb.totalPushed + patches.length
    // slice acp-wire-session-update: כל patch נפלט כפריים `session/update`
    // דרך **אותו** `updateFrame` שה-BE משתמש בו — לא דרך העתק של הפורמט.
    for (const p of patches) {
      const frame = updateFrame(shadowState, p)
      if (frame !== null) pushRaw(frame)
    }
    await pb.waitForTotalAtLeast(target)
  }

  return {
    view,
    nextPatches: (n) => pb.nextPatches(n),
    async emitUpdate(update) {
      // ⚠️ חובה: reduce של core — לא patches ידניים (brief: אחרת התנהגות 3 בודקת את ה-harness).
      const { state, patches } = reduce(shadowState, update as Record<string, unknown>)
      shadowState = state
      await pushAndWait(patches)
    },
    async emitPermission(params) {
      const requestId = nextRequestId++
      const { state, patches } = applyPendingRequest(shadowState, {
        kind: "permission",
        value: { requestId, params: params as never },
      })
      shadowState = state
      await pushAndWait(patches)
      return requestId
    },
    async settle(effect) {
      if (effect === "turn-idle") {
        const { state, patches } = applyTurnEnd(shadowState)
        shadowState = state
        await pushAndWait(patches)
        return
      }
      // pending-cleared: נקה את מה שנשאר pending (permission/elicitation) — נגזר משדה-המקור.
      const kind: PendingKind | null = shadowState.pending.permission
        ? "permission"
        : shadowState.pending.elicitation
          ? "elicitation"
          : null
      if (!kind) return
      const current = shadowState.pending[kind]
      if (!current) return
      const { state, patches } = clearPendingRequest(shadowState, kind, current.requestId)
      shadowState = state
      await pushAndWait(patches)
    },
    outbound: () => outboundLog.filter((o) => o.method !== "reply"),
    async dispose() {
      await pb.dispose()
      await view.close().catch(() => {})
    },
  }
}

// ── shared contract ──────────────────────────────────────────────────────────

describeSessionViewContract("local", createLocalHarness)
describeSessionViewContract("remote-http", () => createRemoteHarness("http"))
describeSessionViewContract("remote-ws", () => createRemoteHarness("ws"))

const terminalRules: ToolOutputRules = {
  fields: {
    text: [{ from: "meta", key: "terminal_output_delta", path: ["data"] }],
    exitCode: [{ from: "meta", key: "terminal_exit", path: ["exit_code"] }],
  },
  metaKeys: {
    terminal_info: "replace",
    terminal_output_delta: "append",
    terminal_exit: "replace",
  },
}

function stripWireMeta(frame: SseFrame): SseFrame {
  function strip({ _meta, ...update }: Record<string, unknown>) {
    return update
  }
  if (frame.event === "snapshot") {
    const snapshot = JSON.parse(frame.data) as { updates: Record<string, unknown>[] }
    return { ...frame, data: JSON.stringify({ ...snapshot, updates: snapshot.updates.map(strip) }) }
  }
  const batch = JSON.parse(frame.data) as {
    params: { update: Record<string, unknown> }
  }[]
  return {
    ...frame,
    data: JSON.stringify(
      batch.map((entry) => ({
        ...entry,
        params: { ...entry.params, update: strip(entry.params.update) },
      })),
    ),
  }
}

function firstToolOutput(state: SessionState): ToolOutput | undefined {
  const message = state.messages[0]
  return message?.role === "tool" ? message.toolCall.output : undefined
}

async function readToolOutput(transport: SessionTransport, transformWsFrame?: FrameTransform) {
  const toolCallId = "exec-fixture"
  const update = { sessionUpdate: "tool_call_update", toolCallId }
  const inputs = [
    { sessionUpdate: "tool_call", toolCallId, kind: "execute", _meta: { terminal_info: {} } },
    { ...update, _meta: { terminal_output_delta: { data: "one\n" } } },
    { ...update, _meta: { terminal_output_delta: { data: "two\n" } } },
    { ...update, status: "failed", _meta: { terminal_exit: { exit_code: 3 } } },
  ]

  let state = createInitialSessionState({ sessionId: "s1" })
  const ack: HandleRequest = () => ({ status: 202, body: {} })
  const { view, pushRaw } = await connectRemoteHarness(transport, state, ack, transformWsFrame)
  const patches = new PatchBuffer(view.patches)
  let frameCount = 0
  let live: ToolOutput | undefined
  try {
    for (const input of inputs) {
      const next = reduce(state, input, { toolOutput: terminalRules })
      state = next.state
      for (const patch of next.patches) {
        const frame = updateFrame(state, patch)
        if (!frame) continue
        pushRaw(frame)
        frameCount++
      }
    }
    await patches.waitForTotalAtLeast(frameCount)
    live = firstToolOutput(view.state)
  } finally {
    await patches.dispose()
    await view.close()
  }

  const late = await connectRemoteHarness(transport, state, ack, transformWsFrame)
  try {
    return { live, snapshot: firstToolOutput(late.view.state) }
  } finally {
    await late.view.close()
  }
}

describe("remote tool output", () => {
  const output = { text: "one\ntwo\n", exitCode: 3 }

  it("keeps canonical output equal across both transports and delivery modes", async () => {
    const sse = await readToolOutput("http")
    const ws = await readToolOutput("ws")
    expect(sse).toEqual({ live: output, snapshot: output })
    expect(ws).toEqual(sse)
  })

  it("detects a WS pipe that strips canonical metadata", async () => {
    const stripped = await readToolOutput("ws", stripWireMeta)
    expect(stripped).not.toEqual({ live: output, snapshot: output })
    expect(stripped).toEqual({ live: undefined, snapshot: undefined })
  })
})

// ── טבלת-הסטייה (brief §C1) ──────────────────────────────────────────────────

describe.each(["http", "ws"] as const)("SessionView deviation table — %s", (transport) => {
  async function connect(rpcStatus = 202): Promise<RemoteSessionView> {
    const snapshot = createInitialSessionState({ sessionId: "s-1" })
    const { view } = await connectRemoteHarness(transport, snapshot, (kind, body) => {
      if (kind === "reply") return { status: 200, body: { ok: true } }
      const { method, params } = body as { method?: string; params?: { sessionId?: string } }
      switch (method) {
        case RPC_METHODS.listSessions:
          return {
            status: 200,
            body: {
              sessions: [{ sessionId: "s-9", cwd: "/w", title: "Listed" }],
              sessionCapabilities: { delete: {} },
            },
          }
        case RPC_METHODS.loadSession:
          return { status: 200, body: { sessionId: params?.sessionId ?? "s", version: 2 } }
        case RPC_METHODS.newSession:
          return { status: 200, body: { sessionId: "s-brand-new", version: 3 } }
        case RPC_METHODS.deleteSession:
          return { status: 200, body: { ok: true } }
        default:
          return { status: rpcStatus, body: { version: 1 } }
      }
    })
    activeViews.push(view)
    return view
  }

  const activeViews: RemoteSessionView[] = []
  afterEach(async () => {
    for (const v of activeViews) await v.close().catch(() => {})
    activeViews.length = 0
  })

  it("newSession/loadSession/listSessions/deleteSession perform real RPCs", async () => {
    const view = await connect()

    await expect(view.newSession("/w")).resolves.toBeUndefined()
    expect(view.state.sessionId).toBe("s-brand-new")

    // loadSession — resolves and updates BOTH sessionId sources from the answer
    await expect(view.loadSession("s-new", "/w")).resolves.toBeUndefined()
    expect(view.state.sessionId).toBe("s-new")

    // listSessions — normalized sessions + capabilities captured (delete gating)
    await expect(view.listSessions()).resolves.toEqual([
      { sessionId: "s-9", cwd: "/w", title: "Listed", updatedAt: "" },
    ])
    expect(view.supportsSessionDelete).toBe(true)

    // deleteSession — resolves on {ok:true}
    await expect(view.deleteSession("s-9")).resolves.toBeUndefined()
  })

  it("prompt(PromptBlocks) passes blocks to RPC without throwing (slice remote-images C1)", async () => {
    const view = await connect()

    await expect(view.prompt([{ type: "text", text: "hi" }] as never)).resolves.toBeUndefined()
  })

  it("rejects a failed RPC (5xx)", async () => {
    const view = await connect(500)

    await expect(view.prompt("hi")).rejects.toThrow("500")
  })

  it("respond() with an unknown id is a silent no-op (like LocalSessionView)", async () => {
    const view = await connect()

    await expect(view.respond(999, {})).resolves.toBeUndefined()
  })
})
