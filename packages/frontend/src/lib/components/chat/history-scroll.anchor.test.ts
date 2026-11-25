// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import type { Bubble } from "$lib/types/bubble"
import { groupActivityRuns } from "./bubbles/activity-groups"
import { createHistoryScroll } from "./history-scroll"

function bubble(id: string): Bubble {
  return { id, messageId: null, createdAt: 0, kind: "thought", segments: [] }
}

function setup() {
  const existing = bubble("existing")
  let items = groupActivityRuns([existing], true)
  const currentKey = items[0]?.key
  const scroller = document.createElement("div")
  let bubbleTop = 10
  const row = document.createElement("div")
  row.dataset.historyBubble = existing.id
  vi.spyOn(row, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, bubbleTop - scroller.scrollTop, 100, 20),
  )
  vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 100))
  scroller.append(row)
  const scroll = createHistoryScroll(
    () => items,
    () => scroller,
    () => undefined,
  )
  const merged = groupActivityRuns(
    [{ ...bubble("earlier-message"), kind: "message" }, bubble("earlier"), existing],
    true,
  )
  const mergedKey = merged[1]?.key
  if (!currentKey || !mergedKey) throw new Error("Missing activity groups in fixture")
  return {
    scroll,
    currentKey,
    mergedKey,
    prepend() {
      items = merged
      bubbleTop += 51
    },
    scroller,
    row,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe("earlier history scroll", () => {
  it.each([true, false])("transfers the existing group's expanded state (%s)", async (open) => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      queueMicrotask(() => callback(0))
      return 0
    })
    const { scroll, currentKey, mergedKey, prepend } = setup()
    scroll.setOpen(currentKey, open)
    // The old state also wins if the destination key was used before.
    scroll.setOpen(mergedKey, !open)
    scroll.onApplying()
    prepend()
    const restored = scroll.onApplied()
    expect(scroll.isOpen(mergedKey)).toBe(open)
    await restored
  })

  it("restores the bubble's screen position after its group's contents grow", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      queueMicrotask(() => callback(0))
      return 0
    })
    const { scroll, prepend, row } = setup()
    const top = row.getBoundingClientRect().top
    scroll.onApplying()
    prepend()
    await scroll.onApplied()
    expect(Math.abs(row.getBoundingClientRect().top - top)).toBeLessThanOrEqual(4)
  })
})
