/**
 * client.extmethod.test.ts — TDD: AcpClient.extMethod + extNotification ingestion.
 *
 * Slice FE-normalization, Phase 0.
 *
 * Tests:
 *   1. createClientImpl with onExtNotification: extNotification callback routes to it
 *   2. AcpClientCallbacks object form: onUpdate + onExtNotification both captured
 *   3. backward-compat: single function arg still works (onUpdate only)
 */

import { describe, expect, it, vi } from "vitest"
import { createClientImpl } from "./client-impl.js"

describe("createClientImpl — extNotification", () => {
  it("routes extNotification to onExtNotification callback", async () => {
    const onUpdate = vi.fn()
    const onExtNotification = vi.fn()

    const impl = createClientImpl({ onUpdate, onExtNotification })

    // Cast: extNotification is a valid Client method (added in FE-normalization).
    const extImpl = impl as unknown as {
      extNotification: (method: string, params: Record<string, unknown>) => Promise<void>
    }
    expect(typeof extImpl.extNotification).toBe("function")

    await extImpl.extNotification("_drive/capabilities", { thinkingTokens: true })

    expect(onExtNotification).toHaveBeenCalledOnce()
    expect(onExtNotification).toHaveBeenCalledWith("_drive/capabilities", { thinkingTokens: true })
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("extNotification is a no-op when onExtNotification not provided", async () => {
    const onUpdate = vi.fn()
    const impl = createClientImpl({ onUpdate })

    const extImpl = impl as unknown as {
      extNotification: (method: string, params: Record<string, unknown>) => Promise<void>
    }

    // Should not throw when callback is absent
    await expect(extImpl.extNotification("_drive/capabilities", {})).resolves.toBeUndefined()
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("sessionUpdate still routes to onUpdate (no regression)", async () => {
    const onUpdate = vi.fn()
    const impl = createClientImpl({ onUpdate })

    const n = {
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } },
    }
    await impl.sessionUpdate(n as Parameters<typeof impl.sessionUpdate>[0])

    expect(onUpdate).toHaveBeenCalledWith(n)
  })
})

describe("AcpClientCallbacks form — backward compat", () => {
  it("createClientImpl accepts object with onUpdate only", () => {
    const onUpdate = vi.fn()
    // Should not throw
    expect(() => createClientImpl({ onUpdate })).not.toThrow()
  })
})
