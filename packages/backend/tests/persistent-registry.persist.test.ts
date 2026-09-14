/**
 * persistent-registry.persist.test.ts — the mirror, and the adoption gate.
 *
 * The gate is the point of the slice: a row on disk is not a live agent. These
 * tests pin that the default returns exactly today's behaviour (empty after a
 * restart) while the file is nonetheless written and re-readable — which is
 * what the sidecar slice needs and what `restart-rehydrate` reads.
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Agent } from "@drive-coding/core"
import { afterEach, describe, expect, it } from "vitest"
import { readAgentStore } from "../src/agents/agents-store.js"
import { adoptNone, createPersistentAgentRegistry } from "../src/agents/persistent-registry.js"

const dirs: string[] = []

function tmpFile(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "persist-reg-"))
  dirs.push(d)
  return path.join(d, "4002.json")
}

afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
  dirs.length = 0
})

describe("createPersistentAgentRegistry", () => {
  it("writes a created agent to disk", async () => {
    const file = tmpFile()
    const reg = createPersistentAgentRegistry({ file })
    const agent = await reg.create({ cliKind: "claude", cwd: os.tmpdir() })
    await reg.flush()

    const onDisk = readAgentStore(file)
    expect(onDisk).toHaveLength(1)
    expect(onDisk[0]?.id).toBe(agent.id)
  })

  it("mirrors an update", async () => {
    const file = tmpFile()
    const reg = createPersistentAgentRegistry({ file })
    const agent = await reg.create({ cliKind: "claude", cwd: os.tmpdir() })
    await reg.update(agent.id, { status: "crashed", crashReason: "boom" })
    await reg.flush()

    expect(readAgentStore(file)[0]?.status).toBe("crashed")
    expect(readAgentStore(file)[0]?.crashReason).toBe("boom")
  })

  it("mirrors a delete", async () => {
    const file = tmpFile()
    const reg = createPersistentAgentRegistry({ file })
    const agent = await reg.create({ cliKind: "claude", cwd: os.tmpdir() })
    await reg.delete(agent.id)
    await reg.flush()

    expect(readAgentStore(file)).toEqual([])
  })

  it("coalesces a burst into a snapshot that still holds every row", async () => {
    const file = tmpFile()
    const reg = createPersistentAgentRegistry({ file })
    await Promise.all(
      Array.from({ length: 20 }, () => reg.create({ cliKind: "claude", cwd: os.tmpdir() })),
    )
    await reg.flush()

    // The guard that matters: coalescing must drop *writes*, never rows.
    expect(readAgentStore(file)).toHaveLength(20)
  })

  it("🔴 loading is not restoring — rows are pending until someone vouches for them", async () => {
    // A row on disk describes a process that may or may not still exist, and
    // finding out costs a round trip. Until restore() is called the registry is
    // empty, which is the honest state.
    const file = tmpFile()
    const first = createPersistentAgentRegistry({ file })
    const agent = await first.create({ cliKind: "claude", cwd: os.tmpdir() })
    await first.flush()

    const second = createPersistentAgentRegistry({ file })
    expect(await second.list()).toEqual([])
    expect(second.pendingRows().map((r) => r.id)).toEqual([agent.id])
    // …and the file is untouched until restore decides.
    expect(readAgentStore(file)).toHaveLength(1)
  })

  it("an empty restore trims the snapshot so dead rows are not offered again", async () => {
    const file = tmpFile()
    const first = createPersistentAgentRegistry({ file })
    await first.create({ cliKind: "claude", cwd: os.tmpdir() })
    await first.flush()
    expect(readAgentStore(file)).toHaveLength(1)

    const second = createPersistentAgentRegistry({ file })
    await second.restore([])
    expect(readAgentStore(file)).toEqual([])
    expect(await second.list()).toEqual([])
  })

  it("🔴 restore keeps id, createdAt and acpSessionId verbatim", async () => {
    // create() would mint a new id and a new createdAt. A restored row has to
    // be the same row — the chat URL contains that id.
    const file = tmpFile()
    const first = createPersistentAgentRegistry({ file })
    const agent = await first.create({ cliKind: "claude", cwd: os.tmpdir() })
    await first.update(agent.id, { acpSessionId: "sess-42", status: "busy" })
    await first.flush()

    const second = createPersistentAgentRegistry({ file })
    await second.restore(second.pendingRows())
    const restored = await second.get(agent.id)
    expect(restored).not.toBeNull()
    expect(restored?.createdAt).toBe(agent.createdAt)
    expect(restored?.acpSessionId).toBe("sess-42")
    expect(restored?.status).toBe("busy")
  })

  it("🔴 create always mints a fresh id — identity survives through restore, not through the caller", async () => {
    // An earlier version let the caller supply `id`, justified as "the chat URL
    // has to survive a restart". It never did any such thing: the HTTP layer
    // strips unknown keys, so the field was unreachable, and restore() preserves
    // identity by seeding rows verbatim instead.
    const file = tmpFile()
    const reg = createPersistentAgentRegistry({ file })
    const a = await reg.create({ cliKind: "claude", cwd: os.tmpdir() })
    const b = await reg.create({ cliKind: "claude", cwd: os.tmpdir() })
    expect(a.id).not.toBe(b.id)
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it("keeps generating an id when the caller supplies none", async () => {
    const reg = createPersistentAgentRegistry({ file: tmpFile() })
    const agent = await reg.create({ cliKind: "claude", cwd: os.tmpdir() })
    expect(agent.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it("survives a corrupt snapshot without failing construction", async () => {
    const file = tmpFile()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, "}{")
    const reg = createPersistentAgentRegistry({ file })
    expect(reg.pendingRows()).toEqual([])
    await reg.restore(reg.pendingRows())
    expect(await reg.list()).toEqual([])
  })

  it("mutations after a restore keep being mirrored", async () => {
    const file = tmpFile()
    const first = createPersistentAgentRegistry({ file })
    const a = await first.create({ cliKind: "claude", cwd: os.tmpdir() })
    await first.flush()

    const second = createPersistentAgentRegistry({ file })
    await second.restore(second.pendingRows())
    await second.update(a.id, { status: "crashed" })
    await second.flush()

    expect(readAgentStore(file)[0]?.status).toBe("crashed")
  })
})
