// @vitest-environment jsdom
/**
 * message-bubble-harness.test.ts — מוכיח ש-resolve.conditions:["browser"]
 * (vitest.config.ts) הופך את mount() לבר-שימוש על MessageBubble.
 *
 * ─── slice/msg-diagrams (Commit 0ב) ───
 *
 * לפני התיקון: mount() זרק lifecycle_function_unavailable ("mount(...) is not
 * available on the server"). זה השער-האדום המקומי של הקומיט הזה — DoD 6 המלא
 * (mermaid בתוך MessageBubble) מגיע ב-Commit 2, אחרי ש-enhance-mermaid קיים.
 */
import { mount, unmount } from "svelte"
import { afterEach, describe, expect, it } from "vitest"
import type { MessageBubble as MessageBubbleType } from "$lib/types/bubble"
import MessageBubbleHarness from "./message-bubble-harness.svelte"

let target: HTMLDivElement | null = null
let app: object | null = null

afterEach(() => {
  if (app !== null) unmount(app)
  target?.remove()
  target = null
  app = null
})

function makeBubble(text: string): MessageBubbleType {
  return {
    id: "b1",
    kind: "message",
    messageId: "m1",
    createdAt: Date.now(),
    segments: [{ id: "s1", text }],
  }
}

describe("MessageBubble — mount() אמיתי (Commit 0ב)", () => {
  it("מרכיב בלי לזרוק lifecycle_function_unavailable, ומרנדר את הטקסט", () => {
    target = document.createElement("div")
    document.body.appendChild(target)

    expect(() => {
      app = mount(MessageBubbleHarness, {
        target,
        props: { bubble: makeBubble("hello world") },
      })
    }).not.toThrow()

    expect(target.textContent).toContain("hello world")
  })
})
