/**
 * agent-events-deliver.test.ts — format + delivery gate (slice be-events-subscribe C3).
 */

import { parseDriveMessage } from "@drive-coding/core/acp/drive-message-envelope"
import { describe, expect, it, vi } from "vitest"
import { createAgentEventBus } from "../session-host/agent-events.js"
import type { ExtendedSessionHost } from "../session-host/session-host.js"
import { formatAgentEventPrompt, wireAgentEventDelivery } from "./agent-events-deliver.js"

describe("formatAgentEventPrompt", () => {
  it("returns a system envelope with required fields", () => {
    const prompt = formatAgentEventPrompt({
      kind: "turn-ended",
      agentId: "00000000-0000-4000-8000-000000000001",
      at: 1_700_000_000_000,
      stopReason: "end_turn",
    })
    expect(prompt.startsWith("[drive-coding event]")).toBe(false)
    const parsed = parseDriveMessage(prompt)
    expect(parsed.isOk()).toBe(true)
    if (parsed.isOk() && parsed.value.source === "system") {
      expect(parsed.value.eventKind).toBe("turn-ended")
      expect(parsed.value.subjectAgent.id).toBe("00000000-0000-4000-8000-000000000001")
      expect(parsed.value.at).toBe(1_700_000_000_000)
      expect(parsed.value.stopReason).toBe("end_turn")
      expect(parsed.value.subjectAgent.name).toBeUndefined()
    }
  })

  it("does not include lastAssistantText without extras", () => {
    const prompt = formatAgentEventPrompt({
      kind: "turn-ended",
      agentId: "a",
      at: 1,
    })
    const parsed = parseDriveMessage(prompt)
    expect(parsed.isOk()).toBe(true)
    if (parsed.isOk() && parsed.value.source === "system") {
      expect(parsed.value.lastAssistantText).toBeUndefined()
    }
  })

  it("includes lastAssistantText on turn-ended when extras provide quote", () => {
    const prompt = formatAgentEventPrompt(
      { kind: "turn-ended", agentId: "a", at: 1, stopReason: "end_turn" },
      { lastAssistantText: { text: "hello", truncated: false } },
    )
    const parsed = parseDriveMessage(prompt)
    expect(parsed.isOk()).toBe(true)
    if (parsed.isOk() && parsed.value.source === "system") {
      expect(parsed.value.lastAssistantText).toEqual({ text: "hello", truncated: false })
    }
  })

  it("omits lastAssistantText on stall-suspected even with extras", () => {
    const prompt = formatAgentEventPrompt(
      { kind: "stall-suspected", agentId: "a", at: 1, silentMs: 100 },
      { lastAssistantText: { text: "x", truncated: false } },
    )
    const parsed = parseDriveMessage(prompt)
    expect(parsed.isOk()).toBe(true)
    if (parsed.isOk() && parsed.value.source === "system") {
      expect(parsed.value.lastAssistantText).toBeUndefined()
    }
  })

  it("includes optional silentMs and lastTurnError when set", () => {
    const prompt = formatAgentEventPrompt({
      kind: "stall-suspected",
      agentId: "agent-x",
      at: 99,
      silentMs: 600_001,
      lastTurnError: { message: "boom" },
    })
    const parsed = parseDriveMessage(prompt)
    expect(parsed.isOk()).toBe(true)
    if (parsed.isOk() && parsed.value.source === "system") {
      expect(parsed.value.silentMs).toBe(600_001)
      expect(parsed.value.lastTurnError).toEqual({ message: "boom" })
    }
  })
})

describe("wireAgentEventDelivery", () => {
  it("prompts subscribers and emits ext_notification on target host", async () => {
    const bus = createAgentEventBus()
    bus.subscribe("target-a", "sub-1")

    const prompt = vi.fn<(sessionId: string, content: string) => Promise<void>>(async () => {})
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
    const text = String(prompt.mock.calls[0]?.[1] ?? "")
    const parsed = parseDriveMessage(text)
    expect(parsed.isOk()).toBe(true)
    if (parsed.isOk() && parsed.value.source === "system") {
      expect(parsed.value.eventKind).toBe("turn-ended")
      expect(parsed.value.lastAssistantText).toBeUndefined()
    }
  })

  it("includes lastAssistantText in prompt when subscriber opted in and host has assistant message", async () => {
    const bus = createAgentEventBus()
    bus.subscribe("target-a", "sub-1", { includeLastAssistantText: true })

    const prompt = vi.fn<(sessionId: string, content: string) => Promise<void>>(async () => {})
    const subscriberHost = {
      state: { sessionId: "sess-sub" },
      prompt,
    } as unknown as ExtendedSessionHost
    const targetHost = {
      state: {
        messages: [
          { role: "user", segments: [{ text: "q" }] },
          { role: "assistant", segments: [{ text: "hello-from-state" }] },
        ],
      },
      emitExtNotification: vi.fn(),
    } as unknown as ExtendedSessionHost

    wireAgentEventDelivery({
      eventBus: bus,
      agentSessionRegistry: {
        getHost: (id: string) => (id === "target-a" ? targetHost : undefined),
        getOrCreateHost: vi.fn(async () => ({ ok: true, entry: { host: subscriberHost } })),
      } as never,
    })

    bus.emit({
      kind: "turn-ended",
      agentId: "target-a",
      at: 42,
      stopReason: "end_turn",
    })

    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce())
    const text = String(prompt.mock.calls[0]?.[1] ?? "")
    const parsed = parseDriveMessage(text)
    expect(parsed.isOk()).toBe(true)
    if (parsed.isOk() && parsed.value.source === "system") {
      expect(parsed.value.lastAssistantText).toEqual({
        text: "hello-from-state",
        truncated: false,
      })
    }
  })

  it("does not include lastAssistantText on stall-suspected even when opted in", async () => {
    const bus = createAgentEventBus()
    bus.subscribe("target-a", "sub-1", { includeLastAssistantText: true })

    const prompt = vi.fn<(sessionId: string, content: string) => Promise<void>>(async () => {})
    const subscriberHost = {
      state: { sessionId: "sess-sub" },
      prompt,
    } as unknown as ExtendedSessionHost
    const targetHost = {
      state: {
        messages: [{ role: "assistant", segments: [{ text: "hello-from-state" }] }],
      },
      emitExtNotification: vi.fn(),
    } as unknown as ExtendedSessionHost

    wireAgentEventDelivery({
      eventBus: bus,
      agentSessionRegistry: {
        getHost: (id: string) => (id === "target-a" ? targetHost : undefined),
        getOrCreateHost: vi.fn(async () => ({ ok: true, entry: { host: subscriberHost } })),
      } as never,
    })

    bus.emit({
      kind: "stall-suspected",
      agentId: "target-a",
      at: 42,
      silentMs: 600_001,
    })

    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce())
    const text = String(prompt.mock.calls[0]?.[1] ?? "")
    const parsed = parseDriveMessage(text)
    expect(parsed.isOk()).toBe(true)
    if (parsed.isOk() && parsed.value.source === "system") {
      expect(parsed.value.lastAssistantText).toBeUndefined()
    }
  })
})
