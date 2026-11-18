/**
 * session-host-permission-policy.test.ts — slice session-create-contract C1 (TDD).
 *
 * Third guard in handleRequestPermission: auto-resolve via resolvePermissionPolicy
 * before entering pending.
 */

import type { RequestPermissionRequest } from "@agentclientprotocol/sdk"
import type { AcpClient, AcpClientCallbacks } from "@drive-coding/provider/client"
import type { ProviderConnection } from "@drive-coding/provider/connection"
import type { BridgeCrashInfo } from "@drive-coding/provider/spawn"
import type { AcpTransport } from "@drive-coding/provider/transport"
import { describe, expect, it, vi } from "vitest"
import { createSessionHostFromConnection } from "./session-host.js"

function makeMockAcpClient(): AcpClient {
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
  } as unknown as AcpClient
}

function makeMockConnection(): ProviderConnection {
  return {
    wire: { onLine: vi.fn(() => () => {}), write: vi.fn(() => true) },
    capabilities: {} as ProviderConnection["capabilities"],
    onFrame: vi.fn(() => () => {}),
    turn: {
      isBusy: vi.fn(() => false),
      lastActivityAt: vi.fn(() => null),
      onChange: vi.fn(() => () => {}),
    },
    onCrash: vi.fn((_cb: (info: BridgeCrashInfo) => void) => () => {}),
    close: vi.fn().mockResolvedValue(undefined),
    pid: null,
  } as unknown as ProviderConnection
}

const PERM_OPTIONS = [
  { optionId: "ao1", name: "Allow once", kind: "allow_once" as const },
  { optionId: "aa1", name: "Allow always", kind: "allow_always" as const },
]

function permParams(options: RequestPermissionRequest["options"]): RequestPermissionRequest {
  return {
    sessionId: "s1",
    toolCall: { toolCallId: "t1", title: "Write" },
    options,
  }
}

async function setupWithPolicy(
  permissionPolicy?: "allow_once" | "allow_always" | "reject_once" | "ask",
) {
  const conn = makeMockConnection()
  let capturedCallbacks: AcpClientCallbacks | undefined

  const host = await createSessionHostFromConnection(conn, {
    permissionPolicy,
    _createAcpClient: async (_transport: AcpTransport, callbacks: AcpClientCallbacks) => {
      capturedCallbacks = callbacks
      return makeMockAcpClient()
    },
  })

  return {
    host,
    get callbacks() {
      if (!capturedCallbacks) throw new Error("_createAcpClient was never called")
      return capturedCallbacks
    },
  }
}

function requestPermission(callbacks: AcpClientCallbacks, params: RequestPermissionRequest) {
  const handler = callbacks.onRequestPermission
  if (!handler) throw new Error("onRequestPermission not wired")
  return handler(params)
}

describe("handleRequestPermission — permissionPolicy third guard (C1)", () => {
  it("allow_once → auto-selected, never enters pending", async () => {
    const { host, callbacks } = await setupWithPolicy("allow_once")

    const response = await requestPermission(callbacks, permParams(PERM_OPTIONS))

    expect(response).toEqual({ outcome: { outcome: "selected", optionId: "ao1" } })
    expect(host.state.pending.permission).toBeNull()
  })

  it("absent policy → enters pending (today's behavior)", async () => {
    const { host, callbacks } = await setupWithPolicy(undefined)

    const responsePromise = requestPermission(callbacks, permParams(PERM_OPTIONS))

    expect(host.state.pending.permission).toEqual({
      requestId: 0,
      params: expect.objectContaining({ sessionId: "s1" }),
    })

    host.respondPermission(0, { outcome: { outcome: "cancelled" } })
    const response = await responsePromise
    expect(response.outcome.outcome).toBe("cancelled")
  })

  it("ask → enters pending (today's behavior)", async () => {
    const { host, callbacks } = await setupWithPolicy("ask")

    void requestPermission(callbacks, permParams(PERM_OPTIONS))

    expect(host.state.pending.permission).not.toBeNull()
  })

  it("kind not offered → enters pending", async () => {
    const { host, callbacks } = await setupWithPolicy("reject_once")

    void requestPermission(
      callbacks,
      permParams([{ optionId: "ao1", name: "Allow once", kind: "allow_once" }]),
    )

    expect(host.state.pending.permission).not.toBeNull()
  })
})
