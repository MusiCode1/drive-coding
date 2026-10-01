/** @vitest-environment jsdom */
import { createInitialSessionState, reduce } from "@drive-coding/core/session"
import { flushSync } from "svelte"
import { describe, expect, it } from "vitest"
import { TranscriptScope } from "./transcript-scope.svelte"

describe("TranscriptScope ownership", () => {
  it("applies an agent frame and notifies a Svelte effect", () => {
    const scope = new TranscriptScope("a")
    const seen: string[] = []
    const stop = $effect.root(() => {
      $effect(() => {
        seen.push(scope.bubbles.map((b) => b.segments.map((s) => s.text).join("")).join("|"))
      })
    })
    flushSync()
    const { patches } = reduce(createInitialSessionState({ sessionId: "a" }), {
      sessionUpdate: "agent_message_chunk",
      messageId: "m1",
      content: { type: "text", text: "hello" },
    })
    scope.applyPatch({ kind: "frame", patches })
    flushSync()
    stop()
    expect(seen).toEqual(["", "hello"])
  })

  it("keeps the display snapshot through a failed replay until connected", () => {
    const scope = new TranscriptScope("a")
    const { patches } = reduce(createInitialSessionState({ sessionId: "a" }), {
      sessionUpdate: "agent_message_chunk",
      messageId: "m1",
      content: { type: "text", text: "old" },
    })
    scope.applyPatch({ kind: "frame", patches })
    scope.beginReplay()
    expect(scope.bubbles).toEqual([])
    expect(scope.renderBubbles).toHaveLength(1)
    scope.connected()
    expect(scope.renderBubbles).toEqual([])
  })
})
