/**
 * agent-events.test.ts — AgentEventBus unit tests (slice be-events-subscribe C0).
 */

import { describe, expect, it } from "vitest"
import {
  createAgentEventBus,
  DEFAULT_STALL_SUSPECT_MS,
  resolveStallSuspectMs,
} from "./agent-events.js"

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
