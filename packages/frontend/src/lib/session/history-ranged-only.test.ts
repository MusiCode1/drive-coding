import { describe, expect, it, vi } from "vitest"
import { createHttpHistoryPipe } from "./wire/http-history-pipe"
import type { HistoryQuery } from "./wire/pipe"

describe("history requests are ranged", () => {
  it("includes a range on every request through the shared HTTP history pipe", async () => {
    const fetch = vi.fn(async (_url: string) => Response.json({}))
    const pipe = createHttpHistoryPipe("https://example.test/api/agents/fixture/history", {
      _fetch: fetch,
    })

    await pipe.get({ tail: true, maxBytes: 100 })
    await pipe.get({ before: 0, maxBytes: 100 })

    const urls = fetch.mock.calls.map(([url]) => new URL(url))
    expect(urls.map(({ search }) => search)).toEqual([
      "?tail=1&maxBytes=100",
      "?before=0&maxBytes=100",
    ])
    expect(urls.every((url) => url.pathname.endsWith("/history"))).toBe(true)
  })

  it("rejects an unbounded request before invoking fetch", async () => {
    const fetch = vi.fn(async () => Response.json({}))
    const pipe = createHttpHistoryPipe("https://example.test/api/agents/fixture/history", {
      _fetch: fetch,
    })

    await expect(pipe.get({} as HistoryQuery)).rejects.toThrow(
      "History requests require tail or before",
    )
    expect(fetch).not.toHaveBeenCalled()
  })
})
