// @vitest-environment jsdom

import { flushSync, mount, unmount } from "svelte"
import { afterEach, describe, expect, it, vi } from "vitest"
import { HistoryState } from "$lib/view-models/history-state.svelte"
import HistoryEdge from "./HistoryEdge.svelte"

vi.mock("$lib/context", () => ({
  getI18n: () => ({ t: (key: string) => key }),
}))

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe("HistoryEdge", () => {
  it("shows the earlier-messages button when hasMore", () => {
    const history = new HistoryState()
    history.window = { firstSeq: 1, lastSeq: 5, hasMore: true, watermark: 0 }
    const target = document.createElement("div")
    const app = mount(HistoryEdge, { target, props: { history, hasBubbles: true } })
    try {
      flushSync()
      expect(target.querySelector("button")?.textContent).toContain("chat.history.loadOlder")
    } finally {
      unmount(app)
    }
  })

  it("disables the earlier-messages button while reloading and enables it again after hydration", () => {
    const history = new HistoryState()
    history.window = { firstSeq: 1, lastSeq: 5, hasMore: true, watermark: 0 }
    const target = document.createElement("div")
    const app = mount(HistoryEdge, { target, props: { history, hasBubbles: true } })
    try {
      flushSync(() => {
        history.reloading = true
      })
      expect(target.querySelector("button")?.disabled).toBe(true)
      flushSync(() => {
        history.reloading = false
      })
      expect(target.querySelector("button")?.disabled).toBe(false)
    } finally {
      unmount(app)
    }
  })

  it("shows error and retry after failures", () => {
    const history = new HistoryState()
    history.error = "network"
    const retry = vi.spyOn(history, "retry")
    const target = document.createElement("div")
    const app = mount(HistoryEdge, { target, props: { history, hasBubbles: false } })
    try {
      flushSync()
      expect(target.textContent).toContain("chat.history.error")
      expect(target.textContent).toContain("chat.history.retry")
      target.querySelector("button")?.click()
      expect(retry).toHaveBeenCalledOnce()
    } finally {
      unmount(app)
    }
  })

  it("hides when no hasMore and no error", () => {
    const history = new HistoryState()
    const target = document.createElement("div")
    const app = mount(HistoryEdge, { target, props: { history, hasBubbles: false } })
    try {
      flushSync()
      expect(target.querySelector('[role="region"]')).toBeNull()
    } finally {
      unmount(app)
    }
  })
})

it("loads once when the edge becomes visible and requires a click after an older error", () => {
  const history = new HistoryState()
  history.window = { firstSeq: 3, lastSeq: 8, hasMore: true, watermark: 0 }
  const load = vi.spyOn(history, "loadOlder")
  const retry = vi.spyOn(history, "retry")
  let visible: ((isIntersecting: boolean) => void) | undefined
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(notify: (entries: { isIntersecting: boolean }[]) => void) {
        visible = (isIntersecting) => notify([{ isIntersecting }])
      }
      observe() {}
      disconnect() {}
    },
  )
  const target = document.createElement("div")
  target.classList.add("chat-scroll")
  Object.defineProperties(target, {
    scrollHeight: { value: 600 },
    clientHeight: { value: 300 },
  })
  const app = mount(HistoryEdge, { target, props: { history, hasBubbles: true } })
  try {
    flushSync()
    const height = target.querySelector("div")?.style.height
    visible?.(true)
    expect(load).not.toHaveBeenCalled()
    visible?.(false)
    visible?.(true)
    expect(load).toHaveBeenCalledOnce()
    flushSync(() => {
      history.olderError = "network"
    })
    visible?.(true)
    expect(load).toHaveBeenCalledOnce()
    target.querySelector("button")?.click()
    expect(load).toHaveBeenCalledTimes(2)
    expect(retry).not.toHaveBeenCalled()
    flushSync(() => {
      history.olderError = null
      history.window.hasMore = false
    })
    expect(target.textContent).toContain("chat.history.start")
    expect(target.querySelector("div")?.style.height).toBe(height)
  } finally {
    unmount(app)
  }
})
