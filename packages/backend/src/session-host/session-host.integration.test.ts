/**
 * session-host.integration.test.ts — Integration tests for SessionHost + ProviderConnection (C4).
 *
 * Testing: integration (brief §C4)
 *
 * Tests the full wiring of createSessionHostFromConnection:
 *   - InProcessAcpTransport is created from conn.wire + conn.onCrash
 *   - AcpClientCallbacks are wired: onUpdate → reduce, onRequestPermission → PendingRequests
 *   - State updates from pumped lines → SessionHost.state
 *   - User message synthesis + meta passthrough
 *   - Permission requests → PendingRequests + respondPermission resolves them
 *   - Permission timeout with default deny
 *
 * Uses injectable _createAcpClient dep to avoid the ACP initialize handshake complexity.
 *
 * ─── slice session-host-pending-surface C2+C3 (integration) ───
 */

import type { SessionNotification } from "@agentclientprotocol/sdk"
import type { Patch } from "@drive-coding/core/session"
import { applyPatch } from "@drive-coding/core/session"
import type { AcpClient, AcpClientCallbacks } from "@drive-coding/provider/client"
import type { ProviderConnection } from "@drive-coding/provider/connection"
import type { BridgeCrashInfo } from "@drive-coding/provider/spawn"
import type { AcpTransport } from "@drive-coding/provider/transport"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createSessionHostFromConnection } from "./session-host.js"

/** קורא patch יחיד מהזרם, עם timeout — לטסטים שלא מריצים fake timers. */
async function readOnePatch(stream: ReadableStream<Patch>): Promise<Patch> {
  const reader = stream.getReader()
  try {
    const result = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 200)),
    ])
    if (result.done) throw new Error("stream closed before patch arrived")
    return result.value
  } finally {
    reader.releaseLock()
  }
}

/** קורא patch יחיד מהזרם, ללא race על טיימר אמיתי — לטסטים תחת vi.useFakeTimers(). */
async function readOnePatchSync(stream: ReadableStream<Patch>): Promise<Patch> {
  const reader = stream.getReader()
  try {
    const result = await reader.read()
    if (result.done) throw new Error("stream closed before patch arrived")
    return result.value
  } finally {
    reader.releaseLock()
  }
}

/** promise נשלטת — לבקרת תזמון client.prompt/client.cancel בטסטים של גבולות-תור (C3). */
function deferred<T>(): {
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (e: unknown) => void
} {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// ── mock helpers ─────────────────────────────────────────────────────────────

function makeMockAcpClient(overrides: Partial<AcpClient> = {}): AcpClient {
  return {
    newSession: vi.fn().mockResolvedValue({ sessionId: "s1" }),
    loadSession: vi.fn().mockResolvedValue({ sessionId: "s1" }),
    prompt: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    conn: {} as AcpClient["conn"],
    capabilities: {},
    authMethods: [],
    deleteSession: vi.fn().mockResolvedValue(undefined),
    setSessionConfigOption: vi.fn().mockResolvedValue({}),
    setSessionMode: vi.fn().mockResolvedValue({}),
    setSessionModel: vi.fn().mockResolvedValue(undefined),
    extMethod: vi.fn().mockResolvedValue({}),
    close: vi.fn(),
    listSessions: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as AcpClient
}

function makeMockConnection(): {
  conn: ProviderConnection
  _triggerLine: (line: string) => void
  _triggerCrash: (info: BridgeCrashInfo) => void
} {
  const lineListeners: Array<(line: string) => void> = []
  const crashListeners: Array<(info: BridgeCrashInfo) => void> = []

  const conn: ProviderConnection = {
    wire: {
      onLine: vi.fn((cb: (line: string) => void) => {
        lineListeners.push(cb)
        return () => {
          const i = lineListeners.indexOf(cb)
          if (i >= 0) lineListeners.splice(i, 1)
        }
      }),
      write: vi.fn(() => true),
    },
    capabilities: {} as ProviderConnection["capabilities"],
    onFrame: vi.fn(() => () => {}),
    turn: {
      isBusy: vi.fn(() => false),
      lastActivityAt: vi.fn(() => null),
      onChange: vi.fn(() => () => {}),
    },
    onCrash: vi.fn((cb: (info: BridgeCrashInfo) => void) => {
      crashListeners.push(cb)
      return () => {
        const i = crashListeners.indexOf(cb)
        if (i >= 0) crashListeners.splice(i, 1)
      }
    }),
    close: vi.fn().mockResolvedValue(undefined),
    pid: null,
  } as unknown as ProviderConnection

  return {
    conn,
    _triggerLine: (line: string) => lineListeners.forEach((cb) => cb(line)),
    _triggerCrash: (info: BridgeCrashInfo) => crashListeners.forEach((cb) => cb(info)),
  }
}

/** Build a SessionNotification for test pumping */
function makeSessionNotification(update: Record<string, unknown>): SessionNotification {
  return {
    sessionId: "s1",
    update: update as SessionNotification["update"],
  }
}

// ── test setup ────────────────────────────────────────────────────────────────

async function setup(permissionTimeoutMs = 5000, elicitationTimeoutMs = 5000) {
  const { conn, _triggerLine, _triggerCrash } = makeMockConnection()
  let capturedCallbacks: AcpClientCallbacks | undefined
  let capturedTransport: AcpTransport | undefined
  const mockClient = makeMockAcpClient()

  const host = await createSessionHostFromConnection(conn, {
    permissionTimeoutMs,
    elicitationTimeoutMs,
    _createAcpClient: async (transport: AcpTransport, callbacks: AcpClientCallbacks) => {
      capturedTransport = transport
      capturedCallbacks = callbacks
      return mockClient
    },
  })

  return {
    host,
    conn,
    mockClient,
    get callbacks() {
      if (!capturedCallbacks) throw new Error("_createAcpClient was never called")
      return capturedCallbacks
    },
    get transport() {
      if (!capturedTransport) throw new Error("_createAcpClient was never called")
      return capturedTransport
    },
    _triggerLine,
    _triggerCrash,
  }
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("createSessionHostFromConnection", () => {
  describe("wiring", () => {
    it("creates a transport that subscribes to conn.wire.onLine", async () => {
      const { conn } = await setup()
      expect(conn.wire.onLine as ReturnType<typeof vi.fn>).toHaveBeenCalled()
    })

    it("creates a transport that subscribes to conn.onCrash", async () => {
      const { conn } = await setup()
      expect(conn.onCrash as ReturnType<typeof vi.fn>).toHaveBeenCalled()
    })

    it("calls _createAcpClient with the transport and callbacks", async () => {
      const { transport, callbacks } = await setup()
      expect(transport).toBeDefined()
      expect(callbacks).toBeDefined()
      expect(typeof callbacks.onUpdate).toBe("function")
      expect(typeof callbacks.onRequestPermission).toBe("function")
      expect(typeof callbacks.onCreateElicitation).toBe("function")
    })
  })

  describe("state updates via onUpdate", () => {
    it("session_info_update → title changes in host.state", async () => {
      const { host, callbacks } = await setup()

      callbacks.onUpdate(
        makeSessionNotification({
          sessionUpdate: "session_info_update",
          title: "From Connection",
        }),
      )

      expect(host.state.title).toBe("From Connection")
    })

    it("multiple updates increment version", async () => {
      const { host, callbacks } = await setup()

      const v0 = host.state.version
      callbacks.onUpdate(
        makeSessionNotification({ sessionUpdate: "session_info_update", title: "A" }),
      )
      callbacks.onUpdate(
        makeSessionNotification({ sessionUpdate: "session_info_update", title: "B" }),
      )

      expect(host.state.version).toBe(v0 + 2)
    })

    it("patches stream emits patches for each update", async () => {
      const { host, callbacks } = await setup()

      const reader = host.patches.getReader()

      callbacks.onUpdate(
        makeSessionNotification({
          sessionUpdate: "session_info_update",
          title: "Patch Test",
        }),
      )

      const result = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 200)),
      ])
      reader.releaseLock()

      expect(result.done).toBe(false)
      const patch = result.value
      expect(patch?.op).toBe("update-session")
    })
  })

  describe("user message synthesis + meta passthrough", () => {
    it("prompt() adds user message to state with meta", async () => {
      const { host } = await setup()
      const meta = { agentId: "a1" }

      await host.prompt("s1", "hello from conn", meta)

      const msg = host.state.messages[0]
      expect(msg?.role).toBe("user")
      expect(msg?.meta).toEqual(meta)
    })

    it("prompt() calls mockClient.prompt", async () => {
      const { host, mockClient } = await setup()

      await host.prompt("s1", "test content")

      expect(mockClient.prompt).toHaveBeenCalledWith("s1", "test content")
    })
  })

  describe("permission requests → PendingRequests", () => {
    it("onRequestPermission creates a pending request resolved by respondPermission", async () => {
      const { host, callbacks } = await setup()

      // Simulate incoming permission request (called by ACP SDK internally)
      const responsePromise = callbacks.onRequestPermission!({
        sessionId: "s1",
        toolCall: {
          toolCallId: "tc1",
          name: "run_bash",
          status: "pending",
        } as Parameters<typeof callbacks.onRequestPermission>[0]["toolCall"],
        options: [],
      } as Parameters<typeof callbacks.onRequestPermission>[0])

      // The host should have a pending permission (requestId = 0)
      // Respond to it
      const responded = host.respondPermission(0, {
        outcome: { outcome: "cancelled" },
      })

      const response = await responsePromise
      expect(response.outcome.outcome).toBe("cancelled")
    })

    it("onRequestPermission times out with default deny when not responded", async () => {
      vi.useFakeTimers()
      const { host, callbacks } = await setup(100)

      const responsePromise = callbacks.onRequestPermission!({
        sessionId: "s1",
        toolCall: {
          toolCallId: "tc2",
          name: "run_bash",
          status: "pending",
        } as Parameters<typeof callbacks.onRequestPermission>[0]["toolCall"],
        options: [],
      } as Parameters<typeof callbacks.onRequestPermission>[0])

      vi.advanceTimersByTime(101)
      vi.useRealTimers()

      const response = await responsePromise
      // Default deny outcome
      expect(response.outcome.outcome).toBe("cancelled")
    })
  })

  describe("elicitation requests → PendingRequests", () => {
    it("onCreateElicitation defaults to cancel when not responded", async () => {
      vi.useFakeTimers()
      const { callbacks } = await setup(100, 100) // elicitationTimeoutMs=100

      const responsePromise = callbacks.onCreateElicitation!({
        sessionId: "s1",
        requestId: 1,
        schema: { type: "object", properties: {} },
      } as Parameters<typeof callbacks.onCreateElicitation>[0])

      // Default value resolves immediately on timeout
      vi.advanceTimersByTime(101)
      vi.useRealTimers()

      const response = await responsePromise
      expect(response.action).toBe("cancel")
    })
  })

  // ─── slice session-host-pending-surface C2: pending surfaced in state + patches ───

  describe("C2 — permission requests surfaced via state.pending + patches", () => {
    it("onRequestPermission sets state.pending.permission and emits one patch", async () => {
      const { host, callbacks } = await setup()
      const params = {
        sessionId: "s1",
        toolCall: { toolCallId: "tc1", name: "run_bash", status: "pending" },
        options: [],
      } as Parameters<typeof callbacks.onRequestPermission>[0]

      const responsePromise = callbacks.onRequestPermission!(params)

      expect(host.state.pending.permission).toEqual({ requestId: 0, params })
      const patch = await readOnePatch(host.patches)
      expect(patch.op).toBe("update-session")

      // drain — respond so the promise doesn't dangle
      host.respondPermission(0, { outcome: { outcome: "cancelled" } })
      await responsePromise
    })

    it("respondPermission resolves the promise, clears pending, and emits a second patch", async () => {
      const { host, callbacks } = await setup()
      const params = {
        sessionId: "s1",
        toolCall: { toolCallId: "tc1", name: "run_bash", status: "pending" },
        options: [],
      } as Parameters<typeof callbacks.onRequestPermission>[0]

      const responsePromise = callbacks.onRequestPermission!(params)
      await readOnePatch(host.patches) // the "set" patch

      host.respondPermission(0, { outcome: { outcome: "selected", optionId: "allow" } })
      const response = await responsePromise
      expect(response.outcome.outcome).toBe("selected")
      expect(host.state.pending.permission).toBeNull()

      const clearPatch = await readOnePatch(host.patches)
      expect(clearPatch.op).toBe("update-session")
    })

    it("timeout: resolves with default AND clears pending AND emits the clear patch", async () => {
      vi.useFakeTimers()
      const { host, callbacks } = await setup(100)
      const params = {
        sessionId: "s1",
        toolCall: { toolCallId: "tc1", name: "run_bash", status: "pending" },
        options: [],
      } as Parameters<typeof callbacks.onRequestPermission>[0]

      const responsePromise = callbacks.onRequestPermission!(params)
      await readOnePatchSync(host.patches) // the "set" patch

      vi.advanceTimersByTime(101)
      vi.useRealTimers()

      const response = await responsePromise
      expect(response.outcome.outcome).toBe("cancelled")
      expect(host.state.pending.permission).toBeNull()
    })

    it("two overlapping permission requests: slot holds the second; the first's finally does not clear it", async () => {
      const { host, callbacks } = await setup()
      const paramsA = {
        sessionId: "s1",
        toolCall: { toolCallId: "tc1", name: "run_bash", status: "pending" },
        options: [],
      } as Parameters<typeof callbacks.onRequestPermission>[0]
      const paramsB = {
        sessionId: "s1",
        toolCall: { toolCallId: "tc2", name: "run_bash", status: "pending" },
        options: [],
      } as Parameters<typeof callbacks.onRequestPermission>[0]

      const responseA = callbacks.onRequestPermission!(paramsA)
      await readOnePatch(host.patches) // set A (requestId=0)
      const responseB = callbacks.onRequestPermission!(paramsB)
      await readOnePatch(host.patches) // set B (requestId=1) — overwrites the slot

      expect(host.state.pending.permission).toEqual({ requestId: 1, params: paramsB })

      // Respond to A (stale requestId=0) — its `finally` must NOT clear B's slot.
      host.respondPermission(0, { outcome: { outcome: "cancelled" } })
      await responseA
      expect(host.state.pending.permission).toEqual({ requestId: 1, params: paramsB })

      // Respond to B — this is the one that actually clears the slot.
      host.respondPermission(1, { outcome: { outcome: "selected", optionId: "allow" } })
      await responseB
      expect(host.state.pending.permission).toBeNull()
    })
  })

  describe("C2 — elicitation requests surfaced via state.pending + patches", () => {
    it("onCreateElicitation sets state.pending.elicitation and emits one patch", async () => {
      const { host, callbacks } = await setup()
      const params = {
        sessionId: "s1",
        requestId: 1,
        schema: { type: "object", properties: {} },
      } as Parameters<typeof callbacks.onCreateElicitation>[0]

      const responsePromise = callbacks.onCreateElicitation!(params)

      expect(host.state.pending.elicitation).toEqual({ requestId: 0, params })
      const patch = await readOnePatch(host.patches)
      expect(patch.op).toBe("update-session")

      host.respondElicitation(0, { action: "cancel" })
      await responsePromise
    })

    it("respondElicitation resolves the promise, clears pending, and emits a second patch", async () => {
      const { host, callbacks } = await setup()
      const params = {
        sessionId: "s1",
        requestId: 1,
        schema: { type: "object", properties: {} },
      } as Parameters<typeof callbacks.onCreateElicitation>[0]

      const responsePromise = callbacks.onCreateElicitation!(params)
      await readOnePatch(host.patches)

      host.respondElicitation(0, { action: "accept", content: {} })
      const response = await responsePromise
      expect(response.action).toBe("accept")
      expect(host.state.pending.elicitation).toBeNull()

      const clearPatch = await readOnePatch(host.patches)
      expect(clearPatch.op).toBe("update-session")
    })

    it("timeout: resolves with default AND clears pending AND emits the clear patch", async () => {
      vi.useFakeTimers()
      const { host, callbacks } = await setup(5000, 100)
      const params = {
        sessionId: "s1",
        requestId: 1,
        schema: { type: "object", properties: {} },
      } as Parameters<typeof callbacks.onCreateElicitation>[0]

      const responsePromise = callbacks.onCreateElicitation!(params)
      await readOnePatchSync(host.patches)

      vi.advanceTimersByTime(101)
      vi.useRealTimers()

      const response = await responsePromise
      expect(response.action).toBe("cancel")
      expect(host.state.pending.elicitation).toBeNull()
    })

    it("two overlapping elicitation requests: slot holds the second; the first's finally does not clear it", async () => {
      const { host, callbacks } = await setup()
      const paramsA = {
        sessionId: "s1",
        requestId: 1,
        schema: { type: "object", properties: {} },
      } as Parameters<typeof callbacks.onCreateElicitation>[0]
      const paramsB = {
        sessionId: "s1",
        requestId: 2,
        schema: { type: "object", properties: {} },
      } as Parameters<typeof callbacks.onCreateElicitation>[0]

      const responseA = callbacks.onCreateElicitation!(paramsA)
      await readOnePatch(host.patches)
      const responseB = callbacks.onCreateElicitation!(paramsB)
      await readOnePatch(host.patches)

      expect(host.state.pending.elicitation).toEqual({ requestId: 1, params: paramsB })

      host.respondElicitation(0, { action: "cancel" })
      await responseA
      expect(host.state.pending.elicitation).toEqual({ requestId: 1, params: paramsB })

      host.respondElicitation(1, { action: "accept", content: {} })
      await responseB
      expect(host.state.pending.elicitation).toBeNull()
    })

    it("two kinds pending simultaneously, with distinct ids (C4: shared requestId counter) — the regression the spread bug would break", async () => {
      const { host, callbacks } = await setup()
      const permParams = {
        sessionId: "s1",
        toolCall: { toolCallId: "tc1", name: "run_bash", status: "pending" },
        options: [],
      } as Parameters<typeof callbacks.onRequestPermission>[0]
      const elicParams = {
        sessionId: "s1",
        requestId: 1,
        schema: { type: "object", properties: {} },
      } as Parameters<typeof callbacks.onCreateElicitation>[0]

      const permResponse = callbacks.onRequestPermission!(permParams)
      await readOnePatch(host.patches)
      const elicResponse = callbacks.onCreateElicitation!(elicParams)
      await readOnePatch(host.patches)

      // Both pending at once — neither overwrote the other (trap #1: a partial spread
      // would have wiped one of them to undefined instead of null). AND their ids are
      // globally unique (C4: a single shared counter, not two independent ones) — this
      // is what lets the client route a reply unambiguously by requestId alone.
      expect(host.state.pending.permission).toEqual({ requestId: 0, params: permParams })
      expect(host.state.pending.elicitation).toEqual({ requestId: 1, params: elicParams })

      host.respondPermission(0, { outcome: { outcome: "selected", optionId: "allow" } })
      await permResponse
      expect(host.state.pending.elicitation).toEqual({ requestId: 1, params: elicParams })

      host.respondElicitation(1, { action: "accept", content: {} })
      await elicResponse
      expect(host.state.pending.permission).toBeNull()
      expect(host.state.pending.elicitation).toBeNull()
    })
  })

  // ─── slice session-host-pending-surface C3: turn boundaries (prompt/cancel) ───

  describe("C3 — turn boundaries: host.prompt", () => {
    it("emits three patches in order: waiting → add-message → idle; turnState is 'waiting' in between", async () => {
      const { host, mockClient } = await setup()
      const d = deferred<void>()
      ;(mockClient.prompt as ReturnType<typeof vi.fn>).mockImplementation(() => d.promise)
      const reader = host.patches.getReader()

      const promptPromise = host.prompt("s1", "hello")

      // hotfix (post-C4, avigail): waiting is emitted BEFORE add-message — the
      // reverse of the original "trap #3" ordering. See the comment above
      // host.prompt in session-host.ts for the full rationale: this is what
      // prevents the FE's per-patch turnState sync from observing a spurious
      // waiting→idle→waiting flicker (double thinking-chime, phantom
      // end-of-turn flush in Speaker).
      const p1 = await reader.read()
      expect(p1.value).toMatchObject({ op: "update-session", changes: { turnState: "waiting" } })
      const p2 = await reader.read()
      expect(p2.value?.op).toBe("add-message")
      expect(host.state.turnState).toBe("waiting") // held here — client.prompt hasn't resolved yet

      d.resolve(undefined)
      const p3 = await reader.read()
      expect(p3.value).toMatchObject({ op: "update-session", changes: { turnState: "idle" } })
      reader.releaseLock()

      await promptPromise
      expect(mockClient.prompt).toHaveBeenCalledWith("s1", "hello")
    })

    it("hotfix regression guard: turnState never dips back to 'idle' between the waiting and add-message patches", async () => {
      // This is the test that prevents the ordering from silently flipping back
      // (add-message before waiting) in a future edit — see session-host.ts's
      // comment above host.prompt for why that would reintroduce the flicker.
      const { host, mockClient } = await setup()
      const d = deferred<void>()
      ;(mockClient.prompt as ReturnType<typeof vi.fn>).mockImplementation(() => d.promise)
      const reader = host.patches.getReader()
      const seenTurnStates: string[] = []

      // ⚠️ Captured BEFORE calling prompt(): host.prompt() runs synchronously
      // through both emit() calls before its first real await (client.prompt),
      // so `host.state` already reflects BOTH patches by the time prompt()
      // returns control — reading it afterwards would silently start the
      // simulation from the already-final state and never be able to observe
      // an "idle" regression, defeating the point of this test.
      let state = host.state
      const promptPromise = host.prompt("s1", "hello")

      // Apply each of the first two patches exactly as a real client would
      // (core applyPatch), recording turnState after each one — this is what
      // AgentSession#syncFromViewState reads per-patch on the FE.
      const p1 = await reader.read()
      state = applyPatch(state, p1.value!)
      seenTurnStates.push(state.turnState)
      const p2 = await reader.read()
      state = applyPatch(state, p2.value!)
      seenTurnStates.push(state.turnState)

      expect(seenTurnStates).toEqual(["waiting", "waiting"]) // never "idle" in between
      expect(seenTurnStates).not.toContain("idle")

      reader.releaseLock()
      d.resolve(undefined)
      await promptPromise
    })

    it("turnState returns to idle after a turn, and a new turn raises it to waiting again (ratchet closed)", async () => {
      const { host, mockClient } = await setup()
      const d = deferred<void>()
      ;(mockClient.prompt as ReturnType<typeof vi.fn>).mockImplementation(() => d.promise)

      const p1 = host.prompt("s1", "first")
      expect(host.state.turnState).toBe("waiting")
      d.resolve(undefined)
      await p1
      expect(host.state.turnState).toBe("idle")

      const d2 = deferred<void>()
      ;(mockClient.prompt as ReturnType<typeof vi.fn>).mockImplementation(() => d2.promise)
      const p2 = host.prompt("s1", "second")
      expect(host.state.turnState).toBe("waiting")
      d2.resolve(undefined)
      await p2
      expect(host.state.turnState).toBe("idle")
    })

    it("failed turn: emits a single idle patch carrying lastTurnError; host.prompt still throws to the direct caller", async () => {
      const { host, mockClient } = await setup()
      const err = { message: "Internal error", data: { details: "actual reason" } }
      ;(mockClient.prompt as ReturnType<typeof vi.fn>).mockRejectedValue(err)

      const reader = host.patches.getReader()
      const promptPromise = host.prompt("s1", "boom")

      await reader.read() // add-message
      await reader.read() // waiting
      await expect(promptPromise).rejects.toBe(err)
      const failPatch = await reader.read()
      reader.releaseLock()

      expect(failPatch.value).toMatchObject({
        op: "update-session",
        changes: { turnState: "idle" },
      })
      expect(host.state.turnState).toBe("idle")
      expect(host.state.lastTurnError?.message).toBe("actual reason") // msgOf priority: data.details
    })

    it("a successful turn after a failed one clears lastTurnError (via applyTurnStart)", async () => {
      const { host, mockClient } = await setup()
      ;(mockClient.prompt as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("first fails"),
      )
      await expect(host.prompt("s1", "first")).rejects.toThrow("first fails")
      expect(host.state.lastTurnError?.message).toBe("first fails")

      ;(mockClient.prompt as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined)
      await host.prompt("s1", "second")
      expect(host.state.lastTurnError).toBeNull()
    })

    it("prompt failure without cancellation writes lastTurnError", async () => {
      const { host, mockClient } = await setup()
      ;(mockClient.prompt as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"))

      await expect(host.prompt("s1", "x")).rejects.toThrow("network down")
      expect(host.state.lastTurnError?.message).toBe("network down")
    })

    it("two overlapping prompts: A resolving after B started emits nothing for A; B's waiting survives", async () => {
      const { host, mockClient } = await setup()
      const dA = deferred<void>()
      const dB = deferred<void>()
      const promptMock = mockClient.prompt as ReturnType<typeof vi.fn>
      promptMock.mockImplementationOnce(() => dA.promise)
      promptMock.mockImplementationOnce(() => dB.promise)

      const pA = host.prompt("s1", "A")
      const pB = host.prompt("s1", "B")
      expect(host.state.turnState).toBe("waiting")

      dA.resolve(undefined)
      await pA
      // A must not have emitted an idle patch — the state-level check is the assertion
      // (a phantom emit from A would flip this back to "idle").
      expect(host.state.turnState).toBe("waiting") // still B's waiting — A didn't touch it

      dB.resolve(undefined)
      await pB
      expect(host.state.turnState).toBe("idle")
    })
  })

  describe("C3 — turn boundaries: host.cancel", () => {
    it("cancel during an active turn emits idle without lastTurnError", async () => {
      const { host, mockClient } = await setup()
      const dPrompt = deferred<void>()
      ;(mockClient.prompt as ReturnType<typeof vi.fn>).mockImplementation(() => dPrompt.promise)

      const promptPromise = host.prompt("s1", "hi")
      expect(host.state.turnState).toBe("waiting")

      await host.cancel("s1")
      expect(host.state.turnState).toBe("idle")
      expect(host.state.lastTurnError).toBeNull()

      dPrompt.reject(new Error("cancelled by agent"))
      await promptPromise.catch(() => {})
    })

    it("client.cancel itself throwing is swallowed — cancel still emits idle, no lastTurnError", async () => {
      const { host, mockClient } = await setup()
      const dPrompt = deferred<void>()
      ;(mockClient.prompt as ReturnType<typeof vi.fn>).mockImplementation(() => dPrompt.promise)
      ;(mockClient.cancel as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("cancel RPC failed"),
      )

      const promptPromise = host.prompt("s1", "hi")
      await host.cancel("s1")
      expect(host.state.turnState).toBe("idle")
      expect(host.state.lastTurnError).toBeNull()

      dPrompt.reject(new Error("cancelled"))
      await promptPromise.catch(() => {})
    })

    it("cancel on an already-idle state emits zero patches (distinguished from client.cancel throwing)", async () => {
      const { host } = await setup()
      expect(host.state.turnState).toBe("idle")

      const reader = host.patches.getReader()
      await host.cancel("s1")
      const race = await Promise.race([
        reader.read().then(() => "patch" as const),
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 50)),
      ])
      reader.releaseLock()
      expect(race).toBe("timeout") // no patch arrived — full no-op
    })

    it("two consecutive cancels: the second is a no-op", async () => {
      const { host, mockClient } = await setup()
      const dPrompt = deferred<void>()
      ;(mockClient.prompt as ReturnType<typeof vi.fn>).mockImplementation(() => dPrompt.promise)

      const promptPromise = host.prompt("s1", "hi")
      await host.cancel("s1")
      expect(host.state.turnState).toBe("idle")

      const versionAfterFirstCancel = host.state.version
      await host.cancel("s1")
      expect(host.state.version).toBe(versionAfterFirstCancel) // second cancel: no-op, no version bump

      dPrompt.reject(new Error("cancelled"))
      await promptPromise.catch(() => {})
    })

    it("cancel then a new prompt that fails: lastTurnError IS written (the stale cancel marker does not apply)", async () => {
      const { host, mockClient } = await setup()
      const dFirst = deferred<void>()
      ;(mockClient.prompt as ReturnType<typeof vi.fn>).mockImplementationOnce(() => dFirst.promise)

      const firstPrompt = host.prompt("s1", "first")
      await host.cancel("s1")
      dFirst.reject(new Error("cancelled"))
      await firstPrompt.catch(() => {})
      expect(host.state.lastTurnError).toBeNull() // cancellation is not a failure

      ;(mockClient.prompt as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("second fails for real"),
      )
      await expect(host.prompt("s1", "second")).rejects.toThrow("second fails for real")
      expect(host.state.lastTurnError?.message).toBe("second fails for real")
    })

    it("cancel when no active turn is a full no-op — an existing lastTurnError survives", async () => {
      const { host, mockClient } = await setup()
      ;(mockClient.prompt as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"))
      await expect(host.prompt("s1", "x")).rejects.toThrow("boom")
      expect(host.state.lastTurnError?.message).toBe("boom")

      const versionBefore = host.state.version
      await host.cancel("s1") // no active turn — must not wipe lastTurnError
      expect(host.state.version).toBe(versionBefore)
      expect(host.state.lastTurnError?.message).toBe("boom")
    })
  })

  describe("C3 — cancel-tail semantics (the one guard: turn === turnSeq)", () => {
    it("a late chunk before the in-flight prompt resolves closes the tail with an idle patch", async () => {
      const { host, callbacks, mockClient } = await setup()
      const dPrompt = deferred<void>()
      ;(mockClient.prompt as ReturnType<typeof vi.fn>).mockImplementation(() => dPrompt.promise)

      const promptPromise = host.prompt("s1", "hi")
      await host.cancel("s1") // first idle emission
      expect(host.state.turnState).toBe("idle")

      // a late chunk arrives before the in-flight prompt resolves — raises the ratchet
      callbacks.onUpdate(
        makeSessionNotification({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "late" },
        }),
      )
      expect(host.state.turnState).toBe("responding")

      dPrompt.resolve(undefined) // the in-flight prompt now resolves (ACP resolves prompt on cancel)
      await promptPromise
      // the second, unguarded-by-cancelledTurn emission cleans the tail
      expect(host.state.turnState).toBe("idle")
    })

    it("no late update ⇒ prompt resolving after cancel is a full no-op (already idle)", async () => {
      const { host, mockClient } = await setup()
      const dPrompt = deferred<void>()
      ;(mockClient.prompt as ReturnType<typeof vi.fn>).mockImplementation(() => dPrompt.promise)

      const promptPromise = host.prompt("s1", "hi")
      await host.cancel("s1")
      const versionAfterCancel = host.state.version

      dPrompt.resolve(undefined)
      await promptPromise
      expect(host.state.turnState).toBe("idle")
      expect(host.state.version).toBe(versionAfterCancel) // no-op — nothing raised the ratchet
    })

    it("scenario 2 — a new prompt while cancel is in flight: B's waiting survives", async () => {
      const { host, mockClient } = await setup()
      const dPromptA = deferred<void>()
      const dCancel = deferred<void>()
      const dPromptB = deferred<void>()
      const promptMock = mockClient.prompt as ReturnType<typeof vi.fn>
      promptMock.mockImplementationOnce(() => dPromptA.promise)
      ;(mockClient.cancel as ReturnType<typeof vi.fn>).mockImplementation(() => dCancel.promise)

      const promptA = host.prompt("s1", "A") // turn 1 → waiting
      const cancelCall = host.cancel("s1") // marks cancelledTurn=1, awaits client.cancel (pending)

      promptMock.mockImplementationOnce(() => dPromptB.promise)
      const promptB = host.prompt("s1", "B") // turn 2 → waiting (turnSeq now 2)
      expect(host.state.turnState).toBe("waiting")

      dCancel.resolve(undefined) // cancel's client.cancel resolves; turn(1) !== turnSeq(2) → no emit
      await cancelCall
      expect(host.state.turnState).toBe("waiting") // B's waiting survived

      dPromptA.resolve(undefined) // A resolves; turn(1) !== turnSeq(2) → no emit
      await promptA
      expect(host.state.turnState).toBe("waiting") // still B's waiting

      dPromptB.resolve(undefined)
      await promptB
      expect(host.state.turnState).toBe("idle")
    })
  })

  describe("S4 extensions — setMode / setConfigOption / extMethod", () => {
    it("setMode delegates to client.setSessionMode with currentState.sessionId", async () => {
      const { host, mockClient } = await setup()

      // Establish a sessionId via newSession (returns { sessionId: 's1' } from mockClient)
      await host.newSession({ cwd: "/test" })

      await host.setMode("compact")

      expect(mockClient.setSessionMode).toHaveBeenCalledWith({
        sessionId: "s1",
        modeId: "compact",
      })
    })

    it("setMode throws 'No session' when sessionId is null", async () => {
      const { host } = await setup()
      // No session started — sessionId is null
      await expect(host.setMode("compact")).rejects.toThrow("No session")
    })

    it("setConfigOption delegates to client.setSessionConfigOption with string value", async () => {
      const { host, mockClient } = await setup()

      await host.newSession({ cwd: "/test" })

      await host.setConfigOption("model", "claude-3-5-sonnet")

      expect(mockClient.setSessionConfigOption).toHaveBeenCalledWith({
        sessionId: "s1",
        configId: "model",
        value: "claude-3-5-sonnet",
      })
    })

    it("setConfigOption delegates to client.setSessionConfigOption with boolean value", async () => {
      const { host, mockClient } = await setup()

      await host.newSession({ cwd: "/test" })

      await host.setConfigOption("verbose", true)

      expect(mockClient.setSessionConfigOption).toHaveBeenCalledWith({
        sessionId: "s1",
        configId: "verbose",
        value: true,
      })
    })

    it("setConfigOption throws 'No session' when sessionId is null", async () => {
      const { host } = await setup()
      await expect(host.setConfigOption("model", "x")).rejects.toThrow("No session")
    })

    it("extMethod delegates to client.extMethod with method + params", async () => {
      const { host, mockClient } = await setup()

      await host.extMethod("_drive/custom", { foo: "bar", n: 42 })

      expect(mockClient.extMethod).toHaveBeenCalledWith("_drive/custom", { foo: "bar", n: 42 })
    })

    it("extMethod works without an active sessionId (no null-guard needed)", async () => {
      const { host, mockClient } = await setup()
      // extMethod does NOT require a sessionId (no guard)
      await expect(host.extMethod("_drive/ping", {})).resolves.not.toThrow()
      expect(mockClient.extMethod).toHaveBeenCalled()
    })
  })
})
