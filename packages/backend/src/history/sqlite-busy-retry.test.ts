import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { openSqliteDb, SqliteDeadlineError } from "./sqlite-adapter.js"
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
    const out = await withSqliteBusyRetryUntil(() => {
      n++
      if (n < 2) throw { code: "ERR_SQLITE_ERROR", errcode: 5 }
      return "ok"
    }, Date.now() + 500)
    expect(out).toBe("ok")
    expect(n).toBe(2)
    expect(getLastRetryAttemptCount()).toBeGreaterThan(1)
  })

  it("heartbeat: timer delay, resolves after lock release, attempts > 1", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dc-retry-heartbeat-"))
    const path = join(dir, "h.sqlite")
    const db1 = openSqliteDb(path)
    const db2 = openSqliteDb(path)
    const timerDelayMs = 10
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      db1.exec("BEGIN EXCLUSIVE")
      resetRetryAttemptCountForTests()
      const t0 = Date.now()
      const targetAt = t0 + timerDelayMs
      let firedAt: number | undefined
      timer = setTimeout(() => {
        firedAt = Date.now()
      }, timerDelayMs)
      const work = withSqliteBusyRetryUntil(() => db2.transaction(() => 1), Date.now() + 400)
      await sleepMs(20)
      expect(firedAt).toBeDefined()
      expect(firedAt! - targetAt).toBeLessThanOrEqual(150)
      try {
        db1.exec("ROLLBACK")
      } catch {
        // best-effort unlock before assertions complete
      }
      await expect(work).resolves.toBe(1)
      expect(getLastRetryAttemptCount()).toBeGreaterThan(1)
    } finally {
      try {
        db1.exec("ROLLBACK")
      } catch {
        // ignore — lock may already be released
      }
      db1.close()
      db2.close()
      rmSync(dir, { recursive: true, force: true })
      if (timer !== undefined) clearTimeout(timer)
    }
  })

  it("throws SqliteDeadlineError with zero fn calls when deadline already passed", async () => {
    resetRetryAttemptCountForTests()
    let calls = 0
    await expect(
      withSqliteBusyRetryUntil(() => {
        calls++
        return 1
      }, Date.now() - 1),
    ).rejects.toBeInstanceOf(SqliteDeadlineError)
    expect(calls).toBe(0)
    expect(getLastRetryAttemptCount()).toBe(0)
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
