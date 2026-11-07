/**
 * session-history-store.test.ts — schema, attach, usage, and persistence rules (brief §4 Commit 1).
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  createInitialTokenUsageRecord,
  type TokenUsageRecord,
  trackUsage,
} from "../usage/token-usage-store.js"
import {
  applySessionHistorySchema,
  listSessionTableColumns,
  SESSION_TABLE_COLUMNS,
} from "./session-history-schema.js"
import { createSessionHistoryStore, sessionHistoryDbPath } from "./session-history-store.js"
import { openSqliteDb } from "./sqlite-adapter.js"

describe("session history schema", () => {
  it("creates all session columns (full schema for part B)", () => {
    const dir = mkdtempSync(join(tmpdir(), "dc-hist-schema-"))
    const db = openSqliteDb(join(dir, "s.sqlite"))
    applySessionHistorySchema(db)
    const cols = listSessionTableColumns(db)
    expect(cols.sort()).toEqual([...SESSION_TABLE_COLUMNS].sort())
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe("createSessionHistoryStore", () => {
  let dir: string

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  async function openStore() {
    dir = mkdtempSync(join(tmpdir(), "dc-hist-store-"))
    return await createSessionHistoryStore(sessionHistoryDbPath(dir))
  }

  it("same cliKind+acpSessionId is one session; different cliKind same id is two", async () => {
    const s = await openStore()
    s.recordAttach({
      agentId: "a1",
      cliKind: "claude",
      cwd: "/p",
      acpSessionId: "same",
      now: 100,
    })
    s.recordAttach({
      agentId: "a2",
      cliKind: "opencode",
      cwd: "/p",
      acpSessionId: "same",
      now: 200,
    })
    expect(s.listProjects().find((p) => p.cwd === "/p")?.sessionCount).toBe(2)
    s.close()
  })

  it("reconnect does not add a session row", async () => {
    const s = await openStore()
    s.recordAttach({
      agentId: "a1",
      cliKind: "claude",
      cwd: "/p",
      acpSessionId: "s1",
      now: 100,
    })
    s.recordAttach({
      agentId: "a1",
      cliKind: "claude",
      cwd: "/p",
      acpSessionId: "s1",
      now: 200,
    })
    expect(s.listProjects()[0]?.sessionCount).toBe(1)
    s.close()
  })

  it("firstSeenAt and createdAt are not overwritten on reconnect", async () => {
    const s = await openStore()
    s.recordAttach({
      agentId: "a1",
      cliKind: "claude",
      cwd: "/p",
      acpSessionId: "s1",
      now: 1_000,
    })
    s.recordAttach({
      agentId: "a1",
      cliKind: "claude",
      cwd: "/p",
      acpSessionId: "s1",
      now: 9_000,
    })
    const db = openSqliteDb(sessionHistoryDbPath(dir))
    const row = db
      .prepare("SELECT firstSeenAt, createdAt FROM sessions WHERE acpSessionId = 's1'")
      .get<{ firstSeenAt: number; createdAt: number }>()
    expect(row?.firstSeenAt).toBe(1_000)
    expect(row?.createdAt).toBe(1_000)
    db.close()
    s.close()
  })

  it("openedByEmail and parentAgentId fill only when empty", async () => {
    const s = await openStore()
    s.recordAttach({
      agentId: "a1",
      cliKind: "claude",
      cwd: "/p",
      acpSessionId: "s1",
      now: 1,
      openedByEmail: "first@x.test",
      parentAgentId: "parent-1",
    })
    s.recordAttach({
      agentId: "a1",
      cliKind: "claude",
      cwd: "/p",
      acpSessionId: "s1",
      now: 2,
      openedByEmail: "second@x.test",
      parentAgentId: "parent-2",
    })
    const db = openSqliteDb(sessionHistoryDbPath(dir))
    const row = db
      .prepare("SELECT openedByEmail, parentAgentId FROM sessions WHERE acpSessionId = 's1'")
      .get<{ openedByEmail: string; parentAgentId: string }>()
    expect(row?.openedByEmail).toBe("first@x.test")
    expect(row?.parentAgentId).toBe("parent-1")
    db.close()
    s.close()
  })

  it("ignores usage when acpSessionId is null", async () => {
    const s = await openStore()
    s.ingestUsageUpdate({
      agentId: "a1",
      acpSessionId: null,
      cliKind: "claude",
      cwd: "/p",
      used: 100,
      size: 1000,
    })
    expect(s.listUsageRecords()).toEqual([])
    s.close()
  })

  it("disk round-trip: open cycle survives reload and compaction matches", async () => {
    const s1 = await openStore()
    s1.ingestUsageUpdate({
      agentId: "a1",
      acpSessionId: "wire-sess",
      cliKind: "claude",
      cwd: "/p",
      used: 239_279,
      size: 1_000_000,
    })
    s1.close()

    const s2 = await createSessionHistoryStore(sessionHistoryDbPath(dir))
    s2.ingestUsageUpdate({
      agentId: "a1",
      acpSessionId: "wire-sess",
      cliKind: "claude",
      cwd: "/p",
      used: 35_985,
      size: 1_000_000,
    })
    const continuous = createInitialTokenUsageRecord({
      acpSessionId: "wire-sess",
      agentId: "a1",
      cliKind: "claude",
      cwd: "/p",
      now: 1_000,
      used: 239_279,
      size: 1_000_000,
    })
    trackUsage(continuous, { used: 35_985, size: 1_000_000 }, 3_000)

    const loaded = s2.listUsageRecords()[0]
    const shape = (cycles: TokenUsageRecord["cycles"]) =>
      cycles.map((c) => ({ peakUsed: c.peakUsed, closed: c.closedAt !== null }))
    expect(loaded).toBeDefined()
    expect(shape(loaded?.cycles ?? [])).toEqual(shape(continuous.cycles))
    s2.close()
  })

  it("closedAt null survives reload", async () => {
    const s = await openStore()
    s.ingestUsageUpdate({
      agentId: "a1",
      acpSessionId: "s1",
      cliKind: "claude",
      cwd: "/p",
      used: 100,
      size: 1000,
    })
    s.close()
    const s2 = await createSessionHistoryStore(sessionHistoryDbPath(dir))
    const c = s2.listUsageRecords()[0]?.cycles[0]
    expect(c?.closedAt).toBeNull()
    s2.close()
  })

  it("listCliSessionRows omits usage when there is no usage report", async () => {
    const s = await openStore()
    s.recordAttach({
      agentId: "a1",
      cliKind: "claude",
      cwd: "/p",
      acpSessionId: "no-usage",
      now: 100,
    })
    const row = s.listCliSessionRows().find((r) => r.cliKind === "claude")
    expect(row?.usage).toBeUndefined()
    s.close()
  })

  it("onTurnEnded increments turns", async () => {
    const s = await openStore()
    s.ingestUsageUpdate({
      agentId: "a1",
      acpSessionId: "s1",
      cliKind: "claude",
      cwd: "/p",
      used: 100,
      size: 1000,
    })
    s.onTurnEnded("a1", "s1", 5_000)
    expect(s.listCliSessionRows()[0]?.turns).toBe(1)
    s.close()
  })

  it("stores titleManual as 0/1 CHECK", async () => {
    const s = await openStore()
    s.close()
    const db = openSqliteDb(sessionHistoryDbPath(dir))
    applySessionHistorySchema(db)
    db.prepare(
      `INSERT INTO sessions (
        cliKind, acpSessionId, agentId, cwd, titleManual,
        firstSeenAt, lastSeenAt, lastAttachedAt, turns
      ) VALUES ('claude','s1','a','/p',1,1,1,1,0)`,
    ).run()
    const row = db.prepare("SELECT titleManual FROM sessions WHERE acpSessionId='s1'").get<{
      titleManual: number
    }>()
    expect(row?.titleManual).toBe(1)
    db.close()
  })
})
