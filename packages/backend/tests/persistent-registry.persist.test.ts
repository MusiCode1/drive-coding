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

const adoptAll = (rows: readonly Agent[]): readonly Agent[] => rows

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

  it("🔴 adopts nothing by default — a stored row is not a live process", async () => {
    const file = tmpFile()
    const first = createPersistentAgentRegistry({ file })
    await first.create({ cliKind: "claude", cwd: os.tmpdir() })
    await first.flush()

    const second = createPersistentAgentRegistry({ file })
    expect(await second.list()).toEqual([])
    expect(adoptNone([{ id: "x" } as Agent])).toEqual([])
  })

  it("rewrites the snapshot at boot so dropped rows do not linger on disk", async () => {
    const file = tmpFile()
    const first = createPersistentAgentRegistry({ file })
    await first.create({ cliKind: "claude", cwd: os.tmpdir() })
    await first.flush()
    expect(readAgentStore(file)).toHaveLength(1)

    createPersistentAgentRegistry({ file }) // adoptNone
    expect(readAgentStore(file)).toEqual([])
  })

  it("an adopting boot restores id, createdAt and status verbatim", async () => {
    const file = tmpFile()
    const first = createPersistentAgentRegistry({ file })
    const agent = await first.create({ cliKind: "claude", cwd: os.tmpdir() })
    await first.update(agent.id, { acpSessionId: "sess-42", status: "busy" })
    await first.flush()

    const second = createPersistentAgentRegistry({ file, adopt: adoptAll })
    const restored = await second.get(agent.id)
    expect(restored).not.toBeNull()
    expect(restored?.createdAt).toBe(agent.createdAt)
    expect(restored?.acpSessionId).toBe("sess-42")
    expect(restored?.status).toBe("busy")
  })

  it("honours a caller-supplied id — the chat URL survives the restart", async () => {
    const file = tmpFile()
    const reg = createPersistentAgentRegistry({ file })
    const id = "22222222-2222-4222-8222-222222222222"
    const agent = await reg.create({ id, cliKind: "claude", cwd: os.tmpdir() })
    expect(agent.id).toBe(id)
    expect((await reg.get(id))?.id).toBe(id)
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
    const reg = createPersistentAgentRegistry({ file, adopt: adoptAll })
    expect(await reg.list()).toEqual([])
  })
})
