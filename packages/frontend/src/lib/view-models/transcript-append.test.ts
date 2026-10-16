import { describe, expect, it, vi } from "vitest"
import type { Bubble, MessageBubble, UserBubble } from "$lib/types/bubble"
import { type AppendContent, canGroupAppend, reduceTranscriptAppend } from "./transcript-append"

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value)
    for (const child of Object.values(value)) freeze(child)
  }
  return value
}
const variants: AppendContent[] = [
  { kind: "image", image: { mimeType: "image/png", data: "synthetic-image" } },
  { kind: "user-placeholder", placeholder: { kind: "audio" } },
  { kind: "agent-placeholder", placeholder: { kind: "resource_link", uri: "file:///synthetic" } },
]
const creation = { id: "created", createdAt: 42 }

describe("pure transcript append", () => {
  it.each(variants)("creates and groups $kind without changing frozen inputs", (content) => {
    const input = freeze<Bubble[]>([])
    const first = reduceTranscriptAppend(input, null, content, creation)
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({ ...creation, messageId: null, segments: [] })
    const last = first[0] as UserBubble | MessageBubble
    last.segments = [{ id: "segment", text: "preserved" }]
    freeze(first)
    const second = reduceTranscriptAppend(first, null, content, undefined)
    expect(second).toHaveLength(1)
    expect(second).not.toBe(first)
    expect(second[0]).not.toBe(first[0])
    expect(second[0]?.segments).toBe(first[0]?.segments)
    expect(second).toEqual(reduceTranscriptAppend(first, null, content, undefined))
    const result = second[0] as UserBubble
    if (content.kind === "image") {
      expect(result.attachments).toEqual(
        Array(2).fill({ mimeType: "image/png", dataBase64: "synthetic-image" }),
      )
      expect((first[0] as UserBubble).attachments).toHaveLength(1)
    } else {
      expect(result.contentPlaceholders).toEqual([content.placeholder, content.placeholder])
      expect((first[0] as UserBubble).contentPlaceholders).toHaveLength(1)
    }
  })

  it.each(variants)("requires matching role and ID for $kind", (content) => {
    const initial = freeze(reduceTranscriptAppend([], "a", content, creation))
    expect(canGroupAppend(initial, "a", content)).toBe(true)
    expect(canGroupAppend(initial, null, content)).toBe(false)
    expect(canGroupAppend(initial, "b", content)).toBe(false)
    expect(
      reduceTranscriptAppend(initial, "b", content, { id: "next", createdAt: 43 }),
    ).toHaveLength(2)
    expect(() => reduceTranscriptAppend(initial, "b", content, undefined)).toThrow("creation")
    const other = variants.find(
      (v) => (v.kind === "agent-placeholder") !== (content.kind === "agent-placeholder"),
    )!
    expect(canGroupAppend(initial, "a", other)).toBe(false)
  })

  it("preserves mixed attachments, placeholders, recording metadata and segment references", () => {
    const input = freeze<UserBubble[]>([
      {
        id: "mixed",
        kind: "user",
        messageId: "id",
        createdAt: 7,
        recordingId: "rec",
        segments: [{ id: "seg", text: "kept" }],
        attachments: [{ mimeType: "image/jpeg", dataBase64: "old" }],
        contentPlaceholders: [{ kind: "resource", label: "old" }],
      },
    ])
    const next = reduceTranscriptAppend(
      input,
      "id",
      { kind: "image", image: { mimeType: "image/png", data: "new" } },
      undefined,
    )
    const bubble = next[0] as UserBubble
    expect(bubble).toMatchObject({ id: "mixed", createdAt: 7, recordingId: "rec" })
    expect(bubble.segments).toBe(input[0]?.segments)
    expect(bubble.contentPlaceholders).toBe(input[0]?.contentPlaceholders)
    expect(bubble.attachments?.map((a) => a.dataBase64)).toEqual(["old", "new"])
    expect(input[0]?.attachments).toHaveLength(1)
  })

  it("does not read clock or UUID even for creation", () => {
    const clock = vi.spyOn(Date, "now").mockImplementation(() => {
      throw Error("clock")
    })
    try {
      expect(reduceTranscriptAppend([], "id", variants[0]!, creation)[0]?.createdAt).toBe(42)
    } finally {
      clock.mockRestore()
    }
  })
})
