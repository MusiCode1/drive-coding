/**
 * session-history-projects.test.ts — ranking, legacy folders, hide (brief Commit 2).
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { insertLegacyFolder } from "./session-history-projects.js"
import { applySessionHistorySchema } from "./session-history-schema.js"
import { createSessionHistoryStore, sessionHistoryDbPath } from "./session-history-store.js"
import { openSqliteDb } from "./sqlite-adapter.js"

describe("session history projects", () => {
  let dir: string

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  function openStore() {
    dir = mkdtempSync(join(tmpdir(), "dc-hist-proj-"))
    return createSessionHistoryStore(sessionHistoryDbPath(dir))
  }

  it("ranks folder with 8 sessions before folder with 3", () => {
    const s = openStore()
    for (let i = 0; i < 8; i++) {
      s.recordAttach({
        agentId: "a",
        cliKind: "claude",
        cwd: "/eight",
        acpSessionId: `e-${i}`,
        now: 100 + i,
      })
    }
    for (let i = 0; i < 3; i++) {
      s.recordAttach({
        agentId: "a",
        cliKind: "claude",
        cwd: "/three",
        acpSessionId: `t-${i}`,
        now: 200 + i,
      })
    }
    const projects = s.listProjects()
    expect(projects[0]?.cwd).toBe("/eight")
    expect(projects[0]?.sessionCount).toBe(8)
    expect(projects[1]?.cwd).toBe("/three")
    expect(projects[1]?.sessionCount).toBe(3)
    s.close()
  })

  it("reconnect to existing session does not inflate sessionCount", () => {
    const s = openStore()
    for (let i = 0; i < 3; i++) {
      s.recordAttach({
        agentId: "a",
        cliKind: "claude",
        cwd: "/three",
        acpSessionId: `t-${i}`,
        now: i,
      })
    }
    s.recordAttach({
      agentId: "a",
      cliKind: "claude",
      cwd: "/three",
      acpSessionId: "t-0",
      now: 9_999,
    })
    expect(s.listProjects().find((p) => p.cwd === "/three")?.sessionCount).toBe(3)
    s.close()
  })

  it("legacy_folders appear with sessionCount 0", () => {
    const s = openStore()
    const db = openSqliteDb(sessionHistoryDbPath(dir))
    applySessionHistorySchema(db)
    insertLegacyFolder(db, {
      cwd: "/legacy-only",
      cliKind: "opencode",
      lastSeenAt: 5_000,
      payload: "{}",
    })
    db.close()
    const row = s.listProjects().find((p) => p.cwd === "/legacy-only")
    expect(row?.sessionCount).toBe(0)
    expect(row?.kind).toBe("opencode")
    s.close()
  })

  it("hide survives store reopen; attach removes hide", () => {
    const s1 = openStore()
    s1.recordAttach({
      agentId: "a",
      cliKind: "claude",
      cwd: "/hidden",
      acpSessionId: "s1",
      now: 1,
    })
    s1.hideFolder("/hidden")
    expect(s1.listProjects().some((p) => p.cwd === "/hidden")).toBe(false)
    s1.close()

    const s2 = createSessionHistoryStore(sessionHistoryDbPath(dir))
    expect(s2.listProjects().some((p) => p.cwd === "/hidden")).toBe(false)
    s2.recordAttach({
      agentId: "a",
      cliKind: "claude",
      cwd: "/hidden",
      acpSessionId: "s2",
      now: 2,
    })
    const back = s2.listProjects().find((p) => p.cwd === "/hidden")
    expect(back?.sessionCount).toBe(2)
    s2.close()
  })

  it("usage ingest does not unhide a hidden folder", () => {
    const s = openStore()
    s.hideFolder("/h")
    s.ingestUsageUpdate({
      agentId: "a",
      acpSessionId: "u1",
      cliKind: "claude",
      cwd: "/h",
      used: 1,
      size: 1,
    })
    expect(s.listProjects().some((p) => p.cwd === "/h")).toBe(false)
    expect(s.listProjects({ includeHidden: true }).some((p) => p.cwd === "/h")).toBe(true)
    s.close()
  })

  it("includeHidden lists hidden cwd for CLI aggregate consumers", () => {
    const s = openStore()
    s.recordAttach({
      agentId: "a",
      cliKind: "claude",
      cwd: "/x",
      acpSessionId: "s1",
      now: 1,
    })
    s.hideFolder("/x")
    expect(s.listProjects({ includeHidden: true }).some((p) => p.cwd === "/x")).toBe(true)
    s.close()
  })
})
