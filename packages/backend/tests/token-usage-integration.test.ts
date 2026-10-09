/**
 * token-usage-integration.test.ts — C3 host + patch fan-out + disk record.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SessionNotification } from "@agentclientprotocol/sdk"
import type { AcpClient, AcpClientCallbacks } from "@drive-coding/provider/client"
import type { ProviderConnection } from "@drive-coding/provider/connection"
import type { AcpTransport } from "@drive-coding/provider/transport"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createInMemoryAgentRegistry } from "../src/agents/registry.js"
import { asTokenUsageStore } from "../src/history/session-history-as-token-usage.js"
import {
  createSessionHistoryStore,
  sessionHistoryDbPath,
} from "../src/history/session-history-store.js"
import { createAgentEventBus } from "../src/session-host/agent-events.js"
import { createTurnEndedEmitter } from "../src/session-host/agent-events-turn.js"
import { createAgentSessionRegistry } from "../src/session-host/registry.js"
import { createSessionHostFromConnection } from "../src/session-host/session-host.js"
import { wireTokenUsagePatches } from "../src/usage/token-usage-patch-wire.js"

function usage(used: number): SessionNotification {
  return {
    sessionId: "s1",
    update: {
      sessionUpdate: "usage_update",
      used,
      size: 1_000_000,
      cost: { amount: 0.1, currency: "USD" },
    },
  } as SessionNotification
}

function running(): SessionNotification {
  return {
    sessionId: "s1",
    update: { sessionUpdate: "state_update", state: "running" },
  } as SessionNotification
}

function idleEnd(): SessionNotification {
  return {
    sessionId: "s1",
    update: { sessionUpdate: "state_update", state: "idle", stopReason: "end_turn" },
  } as SessionNotification
}

describe("token-usage-persistence C3 integration", () => {
  let dir: string

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it("tracks rising usage_updates, compaction, turn end — keyed by acpSessionId", async () => {
    dir = mkdtempSync(join(tmpdir(), "dc-token-int-"))
    const store = asTokenUsageStore(createSessionHistoryStore(sessionHistoryDbPath(dir)))
    const eventBus = createAgentEventBus()
    const busTurn = createTurnEndedEmitter(eventBus)

    const mockConn = {
      agentId: "a1",
      cliKind: "cursor",
      wire: { send: vi.fn(), onLine: () => () => {} },
      onCrash: () => () => {},
      close: vi.fn(),
      pid: null,
    } as unknown as ProviderConnection

    const connectionRegistry = {
      get: vi.fn(() => mockConn),
      getCwd: vi.fn(() => "/tmp/token-int"),
      getCliKind: vi.fn(() => "cursor"),
      getCharter: vi.fn(() => undefined),
      consumeCharter: vi.fn(() => undefined),
      isOwnedByWs: vi.fn(() => false),
      getOwner: vi.fn(() => ({ via: "http" as const })),
      getLastSeenAt: vi.fn(() => Date.now()),
      getEpoch: vi.fn(() => 0),
      getRuntimeInfo: vi.fn(() => ({
        pid: null,
        attached: true,
        busy: false,
        lastMessageAt: null,
        lastSeenAt: Date.now(),
        via: "http" as const,
      })),
      markOwned: vi.fn(),
      markDetached: vi.fn(),
      touchOwner: vi.fn(),
      listHttpConnectionIds: vi.fn(() => []),
      removeConnection: vi.fn(),
    }

    const agentSessionRegistry = createAgentSessionRegistry({
      connectionRegistry: connectionRegistry as never,
      onTurnEnded: (agentId, info) => {
        busTurn(agentId, info)
        store.onTurnEnded(agentId, info.acpSessionId ?? null, Date.now())
      },
      afterHostCreated: (agentId, entry) => {
        wireTokenUsagePatches(
          agentId,
          entry.host,
          entry.broadcaster,
          () => store,
          connectionRegistry as never,
        )
      },
      _createHostFn: async (conn, opts) =>
        createSessionHostFromConnection(conn, {
          ...opts,
          _createAcpClient: async (_transport: AcpTransport, callbacks: AcpClientCallbacks) => {
            const client: AcpClient = {
              newSession: vi.fn().mockResolvedValue({ sessionId: "s1" }),
              loadSession: vi.fn().mockResolvedValue({ sessionId: "s1" }),
              prompt: vi.fn(async () => {
                callbacks.onUpdate?.(running())
                callbacks.onUpdate?.(usage(50_000))
                callbacks.onUpdate?.(usage(239_279))
                callbacks.onUpdate?.(usage(35_985))
                callbacks.onUpdate?.(idleEnd())
              }),
              cancel: vi.fn().mockResolvedValue(undefined),
              conn: {} as AcpClient["conn"],
              capabilities: {},
              setSessionMode: vi.fn(),
              setSessionConfigOption: vi.fn(),
              extMethod: vi.fn(),
              setSessionModel: vi.fn(),
              listSessions: vi.fn(),
              deleteSession: vi.fn(),
            }
            return client
          },
        }),
    })

    const hostResult = await agentSessionRegistry.getOrCreateHost("a1")
    expect(hostResult.ok).toBe(true)
    if (!hostResult.ok) return

    await hostResult.entry.host.prompt("s1", [{ type: "text", text: "hi" }])
    await new Promise((r) => setTimeout(r, 80))
    store.flushOnShutdown()

    const rec = store.listRecords().find((r) => r.acpSessionId === "s1")
    expect(rec).toBeDefined()
    expect(rec!.agentId).toBe("a1")
    expect(rec!.cliKind).toBe("cursor")
    expect(rec!.cwd).toBe("/tmp/token-int")
    expect(rec!.cycles.map((c) => c.peakUsed)).toEqual([239_279, 35_985])
    // turns may stay 0 when turn-lifecycle skips onTurnEnded (patches=[]); track path is what we pin here.
  })
})
