/**
 * session-view-contract.ts — הגדרת ה-contract המשותף בין LocalSessionView ל-RemoteSessionView.
 *
 * describeSessionViewContract() מריץ 8 התנהגויות משותפות פעמיים — פעם עם harness
 * מבוסס-local (mock AcpClient) ופעם עם harness מבוסס-remote (mock fetch/SSE) — ומוכיח
 * ששני המימושים מקיימים אותו חוזה.
 *
 * ⚠️ `view.patches` הוא single-consumer (session-view.ts) — ה-harness מחזיק reader יחיד
 * (PatchBuffer, למטה) ולעולם לא פותח reader שני.
 *
 * ─── slice view-switch C1 (TDD) ───
 */

import type { SessionNotification } from "@agentclientprotocol/sdk"
import type { Patch } from "@drive-coding/core/session"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { SessionView } from "../session-view.js"

// ─── PatchBuffer: reader יחיד + תור-FIFO פנימי ─────────────────────────────────
//
// #pump() קורא frame ודוחף ל-buffer (לא זורק כלום).
// nextPatches(n) מחזיר מה-buffer (וצורך אותו — splice).
// waitForTotalAtLeast(n) ממתין עד ש-n batches נצפו (totalPushed) — **בלי לצרוך** מה-buffer.
// ⇒ settle()/emitUpdate()/emitPermission() קוראים ל-waitForTotalAtLeast (לא ל-nextPatches),
//   כדי שה-batch שהם חיכו לו יישאר זמין ל-nextPatches() הבא שהאסרציה בטסט קוראת.
export class PatchBuffer {
  readonly #reader: ReadableStreamDefaultReader<Patch[]>
  readonly #buffer: Patch[][] = []
  #totalPushed = 0
  #waiters: Array<() => void> = []
  #pumpDone: Promise<void>

  constructor(stream: ReadableStream<Patch[]>) {
    this.#reader = stream.getReader()
    this.#pumpDone = this.#pump()
  }

  get totalPushed(): number {
    return this.#totalPushed
  }

  async #pump(): Promise<void> {
    try {
      while (true) {
        const { done, value } = await this.#reader.read()
        if (done) break
        if (value !== undefined) {
          this.#buffer.push(value)
          this.#totalPushed++
          this.#drainWaiters()
        }
      }
    } catch {
      // stream נסגר/בוטל — תקין (dispose())
    }
  }

  #drainWaiters(): void {
    const waiters = this.#waiters
    this.#waiters = []
    for (const w of waiters) w()
  }

  #wait(): Promise<void> {
    return new Promise((resolve) => this.#waiters.push(resolve))
  }

  /** צורך n batches מה-buffer (ממתין אם חסר). */
  async nextPatches(n: number): Promise<Patch[][]> {
    while (this.#buffer.length < n) await this.#wait()
    return this.#buffer.splice(0, n)
  }

  /** ממתין עד ש-totalPushed >= target — **בלי לצרוך** מה-buffer. */
  async waitForTotalAtLeast(target: number): Promise<void> {
    while (this.#totalPushed < target) await this.#wait()
  }

  async dispose(): Promise<void> {
    try {
      await this.#reader.cancel()
    } catch {
      // כבר סגור
    }
    await this.#pumpDone.catch(() => {})
  }
}

// ─── Contract types (brief §C1) ────────────────────────────────────────────────

export type ContractHarness = {
  view: SessionView
  /** ⚠️ reader יחיד — view.patches הוא single-consumer (session-view.ts). שני getReader() = stream נעול. */
  nextPatches(n: number): Promise<Patch[][]>
  /**
   * local  → callbacks.onUpdate(notification)
   * remote → **חובה להריץ את `reduce` של core** להמרת update→Patch[], ולדחוף כל אחד כ-frame SSE.
   *          ❌ patches ידניים היו הופכים התנהגות 3 לבדיקה של ה-harness במקום של ה-view.
   */
  emitUpdate(update: SessionNotification["update"]): Promise<void>
  emitPermission(params: unknown): Promise<number>
  /**
   * local  → no-op · remote → פולט patch `update-session` ({turnState:"idle"} / {pending:{...}})
   * **וממתין עד שהוחל בפועל** (#drainPatches → #applyIncoming, 3+ קפיצות async).
   */
  settle(effect: "turn-idle" | "pending-cleared"): Promise<void>
  outbound(): Array<{ method: string; params: unknown }>
  dispose(): Promise<void>
}

// ─── Shared contract — 8 ההתנהגויות ────────────────────────────────────────────

export function describeSessionViewContract(
  name: string,
  createHarness: () => Promise<ContractHarness>,
): void {
  describe(`SessionView contract — ${name}`, () => {
    let h: ContractHarness

    beforeEach(async () => {
      h = await createHarness()
    })

    afterEach(async () => {
      await h.dispose()
    })

    it("1. state is a valid SessionState", () => {
      expect(h.view.state).toMatchObject({
        version: expect.any(Number),
        messages: expect.any(Array),
        status: expect.any(String),
        turnState: expect.any(String),
        pending: { permission: null, elicitation: null },
      })
      expect(["idle", "waiting", "thinking", "responding", "calling-tool"]).toContain(
        h.view.state.turnState,
      )
    })

    it("2. agent_message_chunk -> patch; messages grows", async () => {
      const before = h.view.state.messages.length
      await h.emitUpdate({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "hi" },
        messageId: "m1",
      })
      const [batch] = await h.nextPatches(1)
      if (batch === undefined) throw new Error("expected a batch")
      expect(batch.length).toBeGreaterThan(0)
      expect(h.view.state.messages.length).toBeGreaterThan(before)
    })

    it("3. consecutive chunks do not duplicate the message -- 3 chunks -> one message, 3 segments", async () => {
      await h.emitUpdate({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "a" },
        messageId: "m1",
      })
      await h.emitUpdate({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "b" },
        messageId: "m1",
      })
      await h.emitUpdate({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "c" },
        messageId: "m1",
      })
      const assistantMsgs = h.view.state.messages.filter((m) => m.role === "assistant")
      expect(assistantMsgs).toHaveLength(1)
      const msg = assistantMsgs[0]
      if (msg === undefined || msg.role === "tool")
        throw new Error("expected one assistant message")
      expect(msg.segments).toHaveLength(3)
      expect(msg.segments.map((s) => s.text).join("")).toBe("abc")
    })

    it("4. tool_call + tool_call_update -> same toolCallId, op update-tool", async () => {
      await h.emitUpdate({
        sessionUpdate: "tool_call",
        toolCallId: "t1",
        status: "pending",
        title: "Tool",
      })
      await h.emitUpdate({
        sessionUpdate: "tool_call_update",
        toolCallId: "t1",
        status: "completed",
      })
      const toolMsg = h.view.state.messages.find(
        (m) => m.role === "tool" && m.toolCall.toolCallId === "t1",
      )
      expect(toolMsg).toBeDefined()
      if (toolMsg?.role !== "tool") throw new Error("expected tool message")
      expect(toolMsg.toolCall.status).toBe("completed")
    })

    it("5. prompt() sends outbound -- content is a string", async () => {
      await h.view.prompt("hello there")
      expect(h.outbound()).toContainEqual(
        expect.objectContaining({
          method: "prompt",
          params: expect.objectContaining({ content: "hello there" }),
        }),
      )
    })

    it("6. cancel() -> turnState==='idle' (via settle)", async () => {
      await h.emitUpdate({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "hi" },
        messageId: "m1",
      })
      expect(h.view.state.turnState).toBe("responding")
      await h.view.cancel()
      await h.settle("turn-idle")
      expect(h.view.state.turnState).toBe("idle")
    })

    it("7. respond() clears pending", async () => {
      const requestId = await h.emitPermission({
        options: [{ optionId: "allow_once", name: "Allow", kind: "allow_once" }],
      })
      expect(h.view.state.pending.permission).not.toBeNull()
      await h.view.respond(requestId, { outcome: { outcome: "selected", optionId: "allow_once" } })
      await h.settle("pending-cleared")
      expect(h.view.state.pending.permission).toBeNull()
    })

    it("8. close() closes the stream; a second close() does not throw", async () => {
      await expect(h.view.close()).resolves.toBeUndefined()
      await expect(h.view.close()).resolves.toBeUndefined()
    })
  })
}
