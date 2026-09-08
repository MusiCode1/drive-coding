/**
 * agents-store.io.test.ts — the snapshot file itself: what survives a write,
 * and what a damaged file must NOT do to the boot.
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Agent } from "@drive-coding/core"
import { afterEach, describe, expect, it } from "vitest"
import {
  AGENTS_STORE_VERSION,
  readAgentStore,
  stripRuntimeFields,
  writeAgentStore,
} from "../src/agents/agents-store.js"

const dirs: string[] = []

function tmpFile(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "agents-store-"))
  dirs.push(d)
  return path.join(d, "4002.json")
}

const row = (over: Partial<Agent> = {}): Agent => ({
  id: "11111111-1111-4111-8111-111111111111",
  cliKind: "claude",
  cwd: "/tmp",
  modelOverride: null,
  status: "ready",
  createdAt: "2026-09-08T10:00:00.000Z",
  ...over,
})

afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
  dirs.length = 0
})

describe("readAgentStore / writeAgentStore", () => {
  it("round-trips a row", () => {
    const f = tmpFile()
    writeAgentStore(f, [row()])
    expect(readAgentStore(f)).toEqual([row()])
  })

  it("creates the directory it was pointed at", () => {
    const f = path.join(tmpFile(), "..", "nested", "deep", "4002.json")
    writeAgentStore(f, [row()])
    expect(readAgentStore(f)).toHaveLength(1)
  })

  it("a missing file is the first-boot case, not an error", () => {
    expect(readAgentStore(path.join(os.tmpdir(), "no-such-dir-x9", "a.json"))).toEqual([])
  })

  it("a corrupt file yields an empty registry instead of taking the boot down", () => {
    const f = tmpFile()
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, "{not json")
    expect(readAgentStore(f)).toEqual([])
  })

  it("a future version is ignored wholesale", () => {
    const f = tmpFile()
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, JSON.stringify({ version: AGENTS_STORE_VERSION + 1, agents: [row()] }))
    expect(readAgentStore(f)).toEqual([])
  })

  it("drops only the rows that no longer parse, keeping the rest", () => {
    const f = tmpFile()
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(
      f,
      JSON.stringify({ version: AGENTS_STORE_VERSION, agents: [{ id: "nope" }, row()] }),
    )
    const rows = readAgentStore(f)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe(row().id)
  })

  it("🔴 strips title — it describes a live session, not a stored agent", () => {
    const f = tmpFile()
    writeAgentStore(f, [row({ title: "some live title" })])
    expect(readAgentStore(f)[0]?.title).toBeUndefined()
    expect(stripRuntimeFields(row({ title: "x" })).title).toBeUndefined()
  })

  it("leaves no temp file behind", () => {
    const f = tmpFile()
    writeAgentStore(f, [row()])
    expect(fs.readdirSync(path.dirname(f))).toEqual([path.basename(f)])
  })

  it("an unwritable path is swallowed, not thrown", () => {
    // A regular file standing where a directory must be — mkdirSync fails with
    // ENOTDIR instantly and without needing a privileged path.
    // ⚠️ Do NOT reach for /proc here: `mkdirSync("/proc/nope", {recursive:true})`
    // neither returns nor throws on Linux 6.12 / Node 25.9 — it hangs, and the
    // whole vitest run hangs with it (measured 2026-09-08).
    const blocker = path.join(path.dirname(tmpFile()), "not-a-dir")
    fs.mkdirSync(path.dirname(blocker), { recursive: true })
    fs.writeFileSync(blocker, "x")
    expect(() => writeAgentStore(path.join(blocker, "agents.json"), [row()])).not.toThrow()
  })
})
