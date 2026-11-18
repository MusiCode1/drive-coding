/**
 * realtime-voice-call.test.ts — mapping of GPT-Live data-channel events (shapes captured live).
 *
 * Slice: codex-voice-poc.
 */

import { describe, expect, it } from "vitest"
import { mapDataChannelEvent } from "./realtime-voice-call"

describe("mapDataChannelEvent", () => {
  it("maps turn.done to a final transcript per role", () => {
    const raw = JSON.stringify({
      type: "turn.done",
      turn: { id: "t1", role: "user", transcript: " כמה קבצים יש בתיקייה " },
    })
    expect(mapDataChannelEvent(raw)).toEqual({
      type: "transcript",
      role: "user",
      text: "כמה קבצים יש בתיקייה",
    })
  })

  it("maps delegation.created to the delegated text", () => {
    const raw = JSON.stringify({
      type: "delegation.created",
      item: {
        id: "item_1",
        type: "delegation",
        target: "client",
        content: [{ type: "input_text", text: "count the files" }],
      },
    })
    expect(mapDataChannelEvent(raw)).toEqual({ type: "delegation", text: "count the files" })
  })

  it("maps error events, preferring the nested message", () => {
    const raw = JSON.stringify({
      type: "error",
      error: { code: "unknown_parameter", message: "Unknown parameter" },
    })
    expect(mapDataChannelEvent(raw)).toEqual({ type: "error", message: "Unknown parameter" })
  })

  it.each([
    ["non-JSON", "not json"],
    ["an unrelated event", JSON.stringify({ type: "session.usage.updated" })],
    [
      "an empty transcript",
      JSON.stringify({ type: "turn.done", turn: { role: "assistant", transcript: " " } }),
    ],
    [
      "an unknown role",
      JSON.stringify({ type: "turn.done", turn: { role: "system", transcript: "x" } }),
    ],
    ["an empty delegation", JSON.stringify({ type: "delegation.created", item: { content: [] } })],
  ])("ignores %s", (_name, raw) => {
    expect(mapDataChannelEvent(raw)).toBeNull()
  })
})
