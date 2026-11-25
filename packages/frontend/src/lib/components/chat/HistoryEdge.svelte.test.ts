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
})

describe("HistoryEdge", () => {
  it("shows load-all when hasMore", () => {
    const history = new HistoryState()
    history.window = { firstSeq: 1, lastSeq: 5, hasMore: true, watermark: 0 }
    const target = document.createElement("div")
    const app = mount(HistoryEdge, { target, props: { history } })
    try {
      flushSync()
      expect(target.textContent).toContain("chat.history.hasOlder")
      expect(target.textContent).toContain("chat.history.loadAll")
    } finally {
      unmount(app)
    }
  })

  it("shows error and retry after failures", () => {
    const history = new HistoryState()
    history.error = "network"
    const target = document.createElement("div")
    const app = mount(HistoryEdge, { target, props: { history } })
    try {
      flushSync()
      expect(target.textContent).toContain("chat.history.error")
      expect(target.textContent).toContain("chat.history.retry")
    } finally {
      unmount(app)
    }
  })

  it("hides when no hasMore and no error", () => {
    const history = new HistoryState()
    const target = document.createElement("div")
    const app = mount(HistoryEdge, { target, props: { history } })
    try {
      flushSync()
      expect(target.querySelector('[role="region"]')).toBeNull()
    } finally {
      unmount(app)
    }
  })
})
