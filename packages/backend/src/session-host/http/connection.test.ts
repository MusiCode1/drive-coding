/**
 * connection.test.ts — DELETE /api/agents/:id/connection (slice connection-set C0).
 */

import { Hono } from "hono"
import { describe, expect, it, vi } from "vitest"
import type { ConnectionRegistry } from "../../acp/connection-registry.js"
import { CONNECTION_ID_HEADER } from "./connection-id.js"
import { registerConnectionRoute } from "./connection.js"

function makeReg(overrides: Partial<ConnectionRegistry> = {}): ConnectionRegistry {
  return {
    get: vi.fn(() => ({}) as never),
    removeConnection: vi.fn(),
    addConnection: vi.fn(),
    touchConnection: vi.fn(),
    clearAllConnections: vi.fn(),
    getConnectionCount: vi.fn(() => 0),
    connect: vi.fn(),
    getCwd: vi.fn(),
    getCliKind: vi.fn(),
    list: vi.fn(() => []),
    isAttached: vi.fn(() => false),
    getEpoch: vi.fn(() => 0),
    isOwnedByWs: vi.fn(() => false),
    getRuntimeInfo: vi.fn(() => null),
    getLastSeenAt: vi.fn(() => null),
    listHttpConnectionIds: vi.fn(() => []),
    close: vi.fn(),
    onCrash: vi.fn(() => () => {}),
    setWsSocketChecker: vi.fn(),
    ...overrides,
  }
}

describe("DELETE /api/agents/:id/connection", () => {
  it("returns 404 when agent is not in connection registry", async () => {
    const reg = makeReg({ get: vi.fn(() => undefined) })
    const app = new Hono()
    registerConnectionRoute(app, reg)

    const res = await app.request("/api/agents/missing/connection", { method: "DELETE" })
    expect(res.status).toBe(404)
  })

  it("returns 204 and removes row when header present", async () => {
    const removeConnection = vi.fn()
    const reg = makeReg({ removeConnection })
    const closeLiveSocket = vi.fn()
    const app = new Hono()
    registerConnectionRoute(app, reg, { closeLiveSocket })

    const res = await app.request("/api/agents/agent-1/connection", {
      method: "DELETE",
      headers: { [CONNECTION_ID_HEADER]: "conn-a" },
    })

    expect(res.status).toBe(204)
    expect(removeConnection).toHaveBeenCalledWith("agent-1", "conn-a")
    expect(closeLiveSocket).toHaveBeenCalledWith("agent-1", "conn-a")
  })

  it("returns 204 no-op when header missing on registered agent", async () => {
    const removeConnection = vi.fn()
    const reg = makeReg({ removeConnection })
    const app = new Hono()
    registerConnectionRoute(app, reg)

    const res = await app.request("/api/agents/agent-1/connection", { method: "DELETE" })
    expect(res.status).toBe(204)
    expect(removeConnection).not.toHaveBeenCalled()
  })
})
