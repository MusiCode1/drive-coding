/**
 * session-view.contract.test.ts — מריץ את session-view-contract פעמיים: local + remote.
 *
 * Testing: tdd (brief §C1)
 *
 * local  — LocalSessionView עם mock AcpClient (createClient מוזרק).
 * remote — RemoteSessionView עם mock fetch/SSE. ⚠️ ה-harness מריץ `reduce`/`applyPendingRequest`/
 *          `clearPendingRequest`/`applyTurnEnd` מ-core (לא patches ידניים) — כדי שהתנהגות 3
 *          תבדוק את ה-view, לא את ה-harness. כל patch עובר `PatchSchema` (SSEReader מאמת).
 *
 * + טבלת-הסטייה (session mgmt reject, prompt(PromptBlocks) throws, HTTP-כשל, respond id לא-מוכר).
 *
 * ─── slice view-switch C1 (TDD) ───
 */

import type { SessionNotification } from "@agentclientprotocol/sdk"
import {
  applyPendingRequest,
  applyTurnEnd,
  clearPendingRequest,
  createInitialSessionState,
  type Patch,
  type PendingKind,
  reduce,
  type SessionState,
} from "@drive-coding/core/session"
import type { AcpClient } from "@drive-coding/provider/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  type ContractHarness,
  describeSessionViewContract,
  PatchBuffer,
} from "./__contract__/session-view-contract.js"
import { LocalSessionView } from "./local-session-view.js"
import { RemoteSessionView } from "./remote-session-view.js"

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
    prompt: vi.fn(async (sessionId: string, content: unknown) => {
      outboundLog.push({ method: "prompt", params: { sessionId, content } })
    }),
    cancel: vi.fn(async (sessionId: string) => {
      outboundLog.push({ method: "cancel", params: { sessionId } })
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
  push: (event: string, data: unknown) => void
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
    push: (event, data) => {
      ctrl.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
    },
  }
}

async function createRemoteHarness(): Promise<ContractHarness> {
  const outboundLog: Array<{ method: string; params: unknown }> = []
  const sse = makeLiveSSEBody()
  // ⚠️ מלכודת #2 (brief §C1): מונה-version עולה. shadowState הוא ייצוג-הצללה שרק ה-harness
  // מחזיק כדי לגזור patches ב-version נכון דרך reduce/applyPendingRequest/וכו' — RemoteSessionView
  // עצמו אינו רואה אותו, רק את ה-patches שנשלחים על החוט (frame-per-patch, בדיוק כמו production).
  let shadowState: SessionState = createInitialSessionState({ sessionId: "sess-contract" })
  let nextRequestId = 0

  const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/events")) {
      // frame-zero חייב להיות snapshot (brief §C1 harness pitfall #5 — שם event מדויק).
      sse.push("snapshot", shadowState)
      return { ok: true, status: 200, body: sse.body } as unknown as Response
    }
    if (url.includes("/rpc")) {
      const body = init?.body
        ? (JSON.parse(init.body as string) as { method: string; params: unknown })
        : undefined
      if (body) outboundLog.push({ method: body.method, params: body.params })
      // ⚠️ מלכודת #4: mock שמחזיר Response בלי ok:true מפיל כל RPC (RemoteSessionView#post בודק res.ok).
      return {
        ok: true,
        status: 202,
        json: () => Promise.resolve({ version: shadowState.version }),
      } as unknown as Response
    }
    if (url.includes("/reply")) {
      const body = init?.body ? (JSON.parse(init.body as string) as unknown) : undefined
      outboundLog.push({ method: "reply", params: body })
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true }),
      } as unknown as Response
    }
    throw new Error(`unexpected fetch: ${url}`)
  })

  const view = new RemoteSessionView("agent-contract", "http://be.local", {
    _fetch: mockFetch,
    _sleep: () => Promise.resolve(),
  })
  await view.connect()

  const pb = new PatchBuffer(view.patches)

  /** דוחף patches (frame-per-patch — כמו production) וממתין שיוחלו, בלי לצרוך מה-buffer. */
  async function pushAndWait(patches: Patch[]): Promise<void> {
    if (patches.length === 0) return
    const target = pb.totalPushed + patches.length
    for (const p of patches) sse.push("patch", p)
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

// ── shared contract — פעמיים ─────────────────────────────────────────────────

describeSessionViewContract("local", createLocalHarness)
describeSessionViewContract("remote", createRemoteHarness)

// ── טבלת-הסטייה (brief §C1) ──────────────────────────────────────────────────

describe("SessionView deviation table — remote-only behaviors", () => {
  function mockFetchFor(opts: {
    events?: Array<{ event: string; data: string }>
    rpcStatus?: number
  }): (url: string, init?: RequestInit) => Promise<Response> {
    const encoder = new TextEncoder()
    return vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/events")) {
        const frames = opts.events ?? [
          {
            event: "snapshot",
            data: JSON.stringify(createInitialSessionState({ sessionId: "s-1" })),
          },
        ]
        const text = frames.map((f) => `event: ${f.event}\ndata: ${f.data}\n\n`).join("")
        const body = new ReadableStream<Uint8Array>({
          start(ctrl) {
            ctrl.enqueue(encoder.encode(text))
            // keepOpen — a closing stream would spin the no-sleep reconnect loop
            // and #handleReconnected would keep resetting state to the snapshot
            // (the C4 session-mgmt assertions need state to stay put).
          },
        })
        return { ok: true, status: 200, body } as unknown as Response
      }
      if (url.includes("/rpc")) {
        // slice remote-session-mgmt C4: the three blocking mappings answer with
        // real bodies; the six fire-and-forget methods keep the 202 {version}.
        const rawBody = init?.body ? JSON.parse(init.body as string) : undefined
        const rpcMethod = (rawBody as { method?: string } | undefined)?.method
        if (rpcMethod === "listSessions") {
          return {
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                sessions: [{ sessionId: "s-9", cwd: "/w", title: "Listed" }],
                sessionCapabilities: { delete: {} },
              }),
          } as unknown as Response
        }
        if (rpcMethod === "loadSession") {
          const params = (rawBody as { params?: { sessionId?: string } }).params
          return {
            ok: true,
            status: 200,
            json: () => Promise.resolve({ sessionId: params?.sessionId ?? "s", version: 2 }),
          } as unknown as Response
        }
        if (rpcMethod === "deleteSession") {
          return {
            ok: true,
            status: 200,
            json: () => Promise.resolve({ ok: true }),
          } as unknown as Response
        }
        const status = opts.rpcStatus ?? 202
        return {
          ok: status < 300,
          status,
          json: () => Promise.resolve({ version: 1 }),
        } as unknown as Response
      }
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true }),
      } as unknown as Response
    })
  }

  const activeViews: RemoteSessionView[] = []
  afterEach(async () => {
    for (const v of activeViews) await v.close().catch(() => {})
    activeViews.length = 0
  })

  it("newSession still rejects; loadSession/listSessions/deleteSession perform real RPCs (remote-session-mgmt C4)", async () => {
    const view = new RemoteSessionView("a1", "http://be.local", {
      _fetch: mockFetchFor({}),
      _sleep: () => Promise.resolve(),
    })
    activeViews.push(view)
    await view.connect()

    // ❌ newSession stays unsupported (session creation is BE-owned)
    await expect(view.newSession()).rejects.toThrow("not supported in remote mode")

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

  it("prompt(PromptBlocks) throws -- text only is supported in remote mode", async () => {
    const view = new RemoteSessionView("a1", "http://be.local", {
      _fetch: mockFetchFor({}),
      _sleep: () => Promise.resolve(),
    })
    activeViews.push(view)
    await view.connect()

    await expect(view.prompt([{ type: "text", text: "hi" }] as never)).rejects.toThrow(
      "not supported in remote mode",
    )
  })

  it("an HTTP failure (5xx) on any RPC is rejected -- not silently swallowed", async () => {
    const view = new RemoteSessionView("a1", "http://be.local", {
      _fetch: mockFetchFor({ rpcStatus: 500 }),
      _sleep: () => Promise.resolve(),
    })
    activeViews.push(view)
    await view.connect()

    await expect(view.prompt("hi")).rejects.toThrow("500")
  })

  it("respond() with an unknown id is a silent no-op (like LocalSessionView)", async () => {
    const view = new RemoteSessionView("a1", "http://be.local", {
      _fetch: mockFetchFor({
        events: [
          {
            event: "snapshot",
            data: JSON.stringify(
              createInitialSessionState({ sessionId: "s-1" }) as SessionState & {
                pending: { permission: { requestId: number; params: unknown }; elicitation: null }
              },
            ),
          },
        ],
      }),
      _sleep: () => Promise.resolve(),
    })
    activeViews.push(view)
    await view.connect()

    await expect(view.respond(999, {})).resolves.toBeUndefined()
  })
})
