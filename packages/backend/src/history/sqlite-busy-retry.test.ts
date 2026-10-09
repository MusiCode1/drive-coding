import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { openSqliteDb } from "./sqlite-adapter.js"
import {
  getLastRetryAttemptCount,
  resetRetryAttemptCountForTests,
  sleepMs,
  withSqliteBusyRetryUntil,
} from "./sqlite-busy-retry.js"

describe("withSqliteBusyRetryUntil", () => {
  it("returns fn result on first success with attempts === 1", async () => {
    resetRetryAttemptCountForTests()
    await expect(withSqliteBusyRetryUntil(() => 42, Date.now() + 500)).resolves.toBe(42)
    expect(getLastRetryAttemptCount()).toBe(1)
  })

  it("retries on SQLITE_BUSY then succeeds with attempts > 1", async () => {
    resetRetryAttemptCountForTests()
    let n = 0
    const out = await withSqliteBusyRetryUntil(
      () => {
        n++
        if (n < 2) throw { code: "ERR_SQLITE_ERROR", errcode: 5 }
        return "ok"
      },
      Date.now() + 500,
    )
    expect(out).toBe("ok")
    expect(n).toBe(2)
    expect(getLastRetryAttemptCount()).toBeGreaterThan(1)
  })

  it("heartbeat: 10ms timer fires within 150ms while waiting on lock", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dc-retry-heartbeat-"))
    const path = join(dir, "h.sqlite")
    const db1 = openSqliteDb(path)
    const db2 = openSqliteDb(path)
    db1.exec("BEGIN EXCLUSIVE")
    resetRetryAttemptCountForTests()
    const t0 = Date.now()
    let fired = false
    const timer = setTimeout(() => {
      fired = true
    }, 10)
    const work = withSqliteBusyRetryUntil(() => db2.transaction(() => 1), Date.now() + 400).catch(
      () => undefined,
    )
    await sleepMs(20)
    expect(fired).toBe(true)
    expect(Date.now() - t0).toBeLessThan(150)
    db1.exec("ROLLBACK")
    await work
    db1.close()
    db2.close()
    rmSync(dir, { recursive: true, force: true })
    clearTimeout(timer)
  })

  it("rethrows after deadline on persistent busy", async () => {
    const busy = { code: "ERR_SQLITE_ERROR", errcode: 5 }
    await expect(
      withSqliteBusyRetryUntil(() => {
        throw busy
      }, Date.now() + 80),
    ).rejects.toEqual(busy)
  })
})
