/**
 * session-history-get-session-row.test.ts — the per-session lookup that resuming needs.
 *
 * The point of this read is that it answers without a live host, so the cases that
 * matter are "row exists" vs "no row" and the `(cliKind, acpSessionId)` key — not a
 * happy path through a running agent.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createSessionHistoryStore, sessionHistoryDbPath } from "./session-history-store.js"

describe("getSessionRow", () => {
  let dir: string

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  async function openStore() {
    dir = mkdtempSync(join(tmpdir(), "dc-hist-getrow-"))
    return await createSessionHistoryStore(sessionHistoryDbPath(dir))
  }

  it("returns cwd and lastSeenAt for a session we hosted — enough to resume it", async () => {
    const s = await openStore()
    s.recordAttach({
      agentId: "a1",
      cliKind: "claude",
      cwd: "/home/u/proj",
      acpSessionId: "sess-1",
      now: 1_700_000_000_000,
    })

    const row = s.getSessionRow("claude", "sess-1")

    expect(row).toMatchObject({
      cliKind: "claude",
      acpSessionId: "sess-1",
      cwd: "/home/u/proj",
      lastSeenAt: 1_700_000_000_000,
    })
    s.close()
  })

  it("returns undefined for a session with no row — a 404 is 'no row', not 'no session'", async () => {
    const s = await openStore()
    s.recordAttach({
      agentId: "a1",
      cliKind: "claude",
      cwd: "/home/u/proj",
      acpSessionId: "sess-1",
      now: 100,
    })

    expect(s.getSessionRow("claude", "never-hosted")).toBeUndefined()
    s.close()
  })

  it("keys on cliKind too — the same session id under another CLI is a different row", async () => {
    const s = await openStore()
    s.recordAttach({ agentId: "a1", cliKind: "claude", cwd: "/a", acpSessionId: "dup", now: 100 })
    s.recordAttach({ agentId: "a2", cliKind: "codex", cwd: "/b", acpSessionId: "dup", now: 200 })

    expect(s.getSessionRow("claude", "dup")?.cwd).toBe("/a")
    expect(s.getSessionRow("codex", "dup")?.cwd).toBe("/b")
    expect(s.getSessionRow("cursor", "dup")).toBeUndefined()
    s.close()
  })

  it("omits lastTitle rather than reporting null — the column is nullable, the type is not", async () => {
    const s = await openStore()
    s.recordAttach({
      agentId: "a1",
      cliKind: "claude",
      cwd: "/a",
      acpSessionId: "untitled",
      now: 1,
    })

    const row = s.getSessionRow("claude", "untitled")

    expect(row).toBeDefined()
    expect("lastTitle" in (row as object)).toBe(false)
    s.close()
  })
})
