/**
 * client.cursor-ext.test.ts — TDD: safe auto-answers for Cursor's blocking ACP extensions,
 * so a turn does not stall waiting on a UI we don't have yet (MVP).
 *
 * Tests:
 *   1. "cursor/ask_question" → { outcome: { outcome: "skipped" } }
 *   2. "cursor/create_plan"  → { outcome: { outcome: "accepted" } }
 *   3. unknown ext method    → {} (no throw, does not stall)
 *   4. regression: sessionUpdate/requestPermission/extNotification unaffected
 */

import { describe, expect, it, vi } from "vitest"
import { createClientImpl } from "./client-impl.js"

/** extMethod is a valid Client method (Cursor blocking-ext handlers, this slice). */
function asExtMethodHost(impl: ReturnType<typeof createClientImpl>) {
  return impl as unknown as {
    extMethod: (method: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>
  }
}

describe("createClientImpl — Cursor blocking extensions (extMethod)", () => {
  it('1. "cursor/ask_question" → skipped outcome (does not stall the turn)', async () => {
    const impl = createClientImpl({ onUpdate: vi.fn() })
    const result = await asExtMethodHost(impl).extMethod("cursor/ask_question", {
      question: "Should I proceed?",
    })
    expect(result).toEqual({ outcome: { outcome: "skipped" } })
  })

  it('2. "cursor/create_plan" → accepted outcome (does not stall the turn)', async () => {
    const impl = createClientImpl({ onUpdate: vi.fn() })
    const result = await asExtMethodHost(impl).extMethod("cursor/create_plan", {
      plan: "step 1, step 2",
    })
    expect(result).toEqual({ outcome: { outcome: "accepted" } })
  })

  it("3. unknown ext method → {} (safe no-op, never throws/hangs)", async () => {
    const impl = createClientImpl({ onUpdate: vi.fn() })
    await expect(
      asExtMethodHost(impl).extMethod("cursor/generate_image", { prompt: "a cat" }),
    ).resolves.toEqual({})
  })

  it("4. regression: sessionUpdate still routes to onUpdate", async () => {
    const onUpdate = vi.fn()
    const impl = createClientImpl({ onUpdate })
    const n = {
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } },
    }
    await impl.sessionUpdate(n as Parameters<typeof impl.sessionUpdate>[0])
    expect(onUpdate).toHaveBeenCalledWith(n)
  })

  it("4b. regression: requestPermission auto-allow unaffected by extMethod addition", async () => {
    const impl = createClientImpl({ onUpdate: vi.fn() })
    const result = await impl.requestPermission({
      sessionId: "s1",
      toolCall: { toolCallId: "t1" },
      options: [{ optionId: "opt1", name: "Allow once", kind: "allow_once" }],
    } as Parameters<typeof impl.requestPermission>[0])
    expect(result).toEqual({ outcome: { outcome: "selected", optionId: "opt1" } })
  })
})
