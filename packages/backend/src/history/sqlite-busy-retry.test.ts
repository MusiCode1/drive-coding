import { describe, expect, it, vi } from "vitest"
import { sleepMs, withSqliteBusyRetry } from "./sqlite-busy-retry.js"

describe("withSqliteBusyRetry", () => {
  it("returns fn result on first success", async () => {
    await expect(withSqliteBusyRetry(() => 42)).resolves.toBe(42)
  })

  it("retries on SQLITE_BUSY then succeeds", async () => {
    let n = 0
    const out = await withSqliteBusyRetry(
      () => {
        n++
        if (n < 2) throw { code: "SQLITE_BUSY", message: "database is locked" }
        return "ok"
      },
      { delayMs: 1, maxAttempts: 5, maxTotalMs: 500 },
    )
    expect(out).toBe("ok")
    expect(n).toBe(2)
  })

  it("rethrows after max attempts on persistent busy", async () => {
    const busy = { code: "SQLITE_BUSY", message: "database is locked" }
    await expect(
      withSqliteBusyRetry(() => {
        throw busy
      }, { delayMs: 1, maxAttempts: 2, maxTotalMs: 500 }),
    ).rejects.toEqual(busy)
  })

  it("does not retry non-busy errors", async () => {
    const fn = vi.fn(() => {
      throw new Error("other")
    })
    await expect(withSqliteBusyRetry(fn, { maxAttempts: 5 })).rejects.toThrow("other")
    expect(fn).toHaveBeenCalledOnce()
  })

  it("sleepMs resolves without blocking sync (timer-based)", async () => {
    const t0 = Date.now()
    await sleepMs(5)
    expect(Date.now() - t0).toBeLessThan(200)
  })
})
