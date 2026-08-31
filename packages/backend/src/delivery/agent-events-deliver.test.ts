/**
 * agent-events-deliver.test.ts — format + delivery gate (slice be-events-subscribe C3).
 */

import { describe, expect, it, vi } from "vitest"
import { createAgentEventBus } from "../session-host/agent-events.js"
import type { ExtendedSessionHost } from "../session-host/session-host.js"
import { formatAgentEventPrompt, wireAgentEventDelivery } from "./agent-events-deliver.js"

describe("formatAgentEventPrompt", () => {
  it("is facts-only with required fields", () => {
    const prompt = formatAgentEventPrompt({
      kind: "turn-ended",
      agentId: "00000000-0000-4000-8000-000000000001",
      at: 1_700_000_000_000,
      stopReason: "end_turn",
    })
    expect(prompt.startsWith("[drive-coding event]")).toBe(true)
    expect(prompt).toContain("kind: turn-ended")
    expect(prompt).toContain("agentId:")
    expect(prompt).toContain("at:")
    expect(prompt).toContain("stopReason: end_turn")
    expect(prompt.split("\n").every((line) => !line.includes("."))).toBe(true)
  })

  it("includes optional silentMs and lastTurnError when set", () => {
    const prompt = formatAgentEventPrompt({
      kind: "stall-suspected",
      agentId: "agent-x",
      at: 99,
      silentMs: 600_001,
      lastTurnError: { message: "boom" },
    })
    expect(prompt).toContain("silentMs: 600001")
    expect(prompt).toContain("lastTurnError.message: boom")
  })
})

describe("wireAgentEventDelivery", () => {
  it("prompts subscribers and emits ext_notification on target host", async () => {
    const bus = createAgentEventBus()
    bus.subscribe("target-a", "sub-1")

    const prompt = vi.fn(async () => {})
    const emitExtNotification = vi.fn()
    const subscriberHost = {
      state: { sessionId: "sess-sub" },
      prompt,
    } as unknown as ExtendedSessionHost
    const targetHost = { emitExtNotification } as unknown as ExtendedSessionHost

    wireAgentEventDelivery({
      eventBus: bus,
      agentSessionRegistry: {
        getHost: (id: string) => (id === "target-a" ? targetHost : undefined),
        getOrCreateHost: vi.fn(async () => ({ ok: true, entry: { host: subscriberHost } })),
      } as never,
    })

    const event = {
      kind: "turn-ended" as const,
      agentId: "target-a",
      at: 42,
      stopReason: "end_turn",
    }
    bus.emit(event)

    expect(emitExtNotification).toHaveBeenCalledWith("_drive/agent_event", event)
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce())
    const text = prompt.mock.calls[0]?.[1] as string
    expect(text).toContain("kind:")
    expect(text).toContain("agentId:")
    expect(text.startsWith("[drive-coding event]")).toBe(true)
  })
})
