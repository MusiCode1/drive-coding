import { readFileSync } from "node:fs"
import { createInitialSessionState, type Patch } from "@drive-coding/core/session"
import { Hono } from "hono"
import { expect, it, vi } from "vitest"
import type { ConnectionRegistry } from "../../acp/connection-registry.js"
import { registerEventsRoute } from "../http/events.js"
import type { PatchesBroadcaster } from "../patches-broadcaster.js"
import type { AgentSessionRegistry } from "../registry.js"
import type { ExtendedSessionHost } from "../session-host.js"

const path = "/api/agents/fixture-agent/events"

it("preserves the snapshot, update and keepalive SSE bytes across an epoch change", async () => {
  let patches!: ReadableStreamDefaultController<Patch>
  const patchStream = new ReadableStream<Patch>({
    start(controller) {
      patches = controller
    },
  })
  const broadcaster = {
    subscribe: () => patchStream,
    oldestBufferedVersion: () => undefined,
    unsubscribe: vi.fn(),
    close: vi.fn(),
  } satisfies PatchesBroadcaster
  const host = {
    state: createInitialSessionState({ sessionId: "fixture-session" }),
  } as unknown as ExtendedSessionHost
  let epoch = 1
  const registry = {
    getEpoch: () => epoch,
    getOrCreateHost: async () => ({ ok: true as const, entry: { host, broadcaster } }),
  } as unknown as AgentSessionRegistry
  const connectionRegistry = {
    addConnection: vi.fn(),
    removeConnection: vi.fn(),
  } as unknown as ConnectionRegistry
  let tick!: () => void
  const app = new Hono()
  registerEventsRoute(app, registry, connectionRegistry, {
    _setInterval: ((fn: () => void) => {
      tick = fn
      return 1
    }) as unknown as typeof setInterval,
    _clearInterval: vi.fn(),
  })

  const response = (await app.request(path)) as { status: number; body: ReadableStream<Uint8Array> }
  expect(response.status).toBe(200)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = decoder.decode((await reader.read()).value)
  patches.enqueue({ version: 1, op: "update-session", changes: { title: "Fixture title" } })
  bytes += decoder.decode((await reader.read()).value)
  tick()
  bytes += decoder.decode((await reader.read()).value)
  epoch = 2
  patches.close()
  expect((await reader.read()).done).toBe(true)

  const fixture = new URL("./fixtures/viewer-stream-sse.json", import.meta.url)
  expect(bytes).toBe(JSON.parse(readFileSync(fixture, "utf8")))
})

it("returns structured HTTP 401 when opening the host requires authentication", async () => {
  const authMethods = [{ id: "sign-in", name: "Sign in" }]
  const error = Object.assign(new Error("sign in"), { kind: "auth_required", authMethods })
  const registry = {
    getOrCreateHost: vi.fn().mockRejectedValue(error),
  } as unknown as AgentSessionRegistry
  const app = new Hono()
  registerEventsRoute(app, registry, {} as ConnectionRegistry)
  const response = (await app.request(path)) as { status: number; json(): Promise<unknown> }
  expect(response.status).toBe(401)
  expect(await response.json()).toEqual({ error: "sign in", kind: "auth_required", authMethods })
})
