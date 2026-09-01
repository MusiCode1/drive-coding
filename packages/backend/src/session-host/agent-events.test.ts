/**
 * agent-events.test.ts — AgentEventBus + stall sweep unit tests (slice be-events-subscribe).
 */

import { describe, expect, it, vi } from "vitest"
import {
  createAgentEventBus,
  DEFAULT_STALL_SUSPECT_MS,
  resolveStallSuspectMs,
} from "./agent-events.js"
import { computeSilentMs, runStallSweep } from "./agent-events-stall.js"
import type { ExtendedSessionHost } from "./session-host.js"

describe("resolveStallSuspectMs", () => {
  it("returns default when env is missing", () => {
    expect(resolveStallSuspectMs(undefined)).toBe(DEFAULT_STALL_SUSPECT_MS)
  })

  it("returns default for blank, NaN, zero, negative, Infinity", () => {
    expect(resolveStallSuspectMs("")).toBe(DEFAULT_STALL_SUSPECT_MS)
    expect(resolveStallSuspectMs("  ")).toBe(DEFAULT_STALL_SUSPECT_MS)
    expect(resolveStallSuspectMs("nope")).toBe(DEFAULT_STALL_SUSPECT_MS)
    expect(resolveStallSuspectMs("0")).toBe(DEFAULT_STALL_SUSPECT_MS)
    expect(resolveStallSuspectMs("-1")).toBe(DEFAULT_STALL_SUSPECT_MS)
    expect(resolveStallSuspectMs("Infinity")).toBe(DEFAULT_STALL_SUSPECT_MS)
  })

  it("parses a valid positive number", () => {
    expect(resolveStallSuspectMs("5000")).toBe(5000)
  })
})

describe("AgentEventBus", () => {
  it("subscribe is idempotent", () => {
    const bus = createAgentEventBus()
    bus.subscribe("target-a", "sub-1")
    bus.subscribe("target-a", "sub-1")
    expect(bus.subscribersOf("target-a")).toEqual(["sub-1"])
  })

  it("emit delivers to onEvent with subscriber list", () => {
    const bus = createAgentEventBus()
    bus.subscribe("target-a", "sub-1")
    bus.subscribe("target-a", "sub-2")
    const received: Array<{ e: unknown; subs: readonly string[] }> = []
    bus.onEvent((e, subscriberIds) => {
      received.push({ e, subs: subscriberIds })
    })
    const event = {
      kind: "turn-ended" as const,
      agentId: "target-a",
      at: 1,
      stopReason: "end_turn",
    }
    bus.emit(event)
    expect(received).toHaveLength(1)
    expect(received[0]?.e).toEqual(event)
    expect(received[0]?.subs).toEqual(expect.arrayContaining(["sub-1", "sub-2"]))
    expect(received[0]?.subs).toHaveLength(2)
  })

  it("unsubscribe removes a subscriber", () => {
    const bus = createAgentEventBus()
    bus.subscribe("target-a", "sub-1")
    bus.unsubscribe("target-a", "sub-1")
    expect(bus.subscribersOf("target-a")).toEqual([])
  })
})

function mockHost(state: {
  turnState: ExtendedSessionHost["state"]["turnState"]
  turnStartedAt: number
  stallReported?: boolean
}): ExtendedSessionHost {
  let stallReported = state.stallReported ?? false
  return {
    state: { turnState: state.turnState } as ExtendedSessionHost["state"],
    getTurnStartedAt: () => state.turnStartedAt,
    getStallReported: () => stallReported,
    markStallReported: () => {
      stallReported = true
    },
  } as ExtendedSessionHost
}

describe("stall-suspected sweep", () => {
  it("(a) waiting turn with no frames above threshold emits once; agent stays registered", () => {
    const now = 100_000
    const turnStartedAt = now - 100
    const map = new Map([
      ["agent-a", { host: mockHost({ turnState: "waiting", turnStartedAt }) }],
    ])
    const suspected: Array<{ agentId: string; silentMs: number }> = []
    runStallSweep({
      now,
      map,
      connectionRegistry: {
        getRuntimeInfo: () => ({ lastMessageAt: null }),
      } as never,
      stallSuspectMs: 50,
      onStallSuspected: (agentId, silentMs) => suspected.push({ agentId, silentMs }),
    })
    expect(suspected).toEqual([{ agentId: "agent-a", silentMs: 100 }])
    expect(map.has("agent-a")).toBe(true)
    expect(map.get("agent-a")?.host.getStallReported()).toBe(true)
  })

  it("(b) stale lastMessageAt from prior turn does not fire after fresh applyTurnStart", () => {
    const now = 100_000
    const turnStartedAt = now - 10
    const staleLastMessageAt = now - 200
    expect(computeSilentMs(now, turnStartedAt, staleLastMessageAt)).toBe(10)
    const map = new Map([
      ["agent-b", { host: mockHost({ turnState: "waiting", turnStartedAt }) }],
    ])
    const suspected: string[] = []
    runStallSweep({
      now,
      map,
      connectionRegistry: {
        getRuntimeInfo: () => ({ lastMessageAt: staleLastMessageAt }),
      } as never,
      stallSuspectMs: 50,
      onStallSuspected: (agentId) => suspected.push(agentId),
    })
    expect(suspected).toEqual([])
  })
})
