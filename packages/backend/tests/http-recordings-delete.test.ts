import { randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { addSink } from "@drive-coding/core/log"
import { Hono } from "hono"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { issueToken, SCOPE_HEADER, verifyToken } from "../src/agent-scope.js"
import { buildApp } from "../src/boot/app.js"
import { createDeps, type Disposable } from "../src/boot/deps.js"
import { readScopeToken } from "../src/scope-write.js"

let stateDir: string

vi.mock("../src/paths.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/paths.js")>()),
  ensureStateSubdir: (...segments: string[]) => {
    const path = join(stateDir, ...segments)
    mkdirSync(path, { recursive: true })
    return path
  },
}))

vi.mock("@drive-coding/provider/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@drive-coding/provider/config")>()),
  onConfigChange: vi.fn(),
}))

const master = "recordings-test-master"
const bytes = Buffer.from([42, 43, 44])
const route = (id: string) => `/api/recordings/${encodeURIComponent(id)}`

describe("DELETE /api/recordings/:id on the production HTTP app", () => {
  let app: Hono
  let disposables: Disposable[]
  let deleteRecording: ReturnType<typeof vi.fn<(id: string) => Promise<void>>>
  let baseDir: string

  async function boot() {
    const config = {
      agentsStoreFile: join(stateDir, "agents.json"),
      historyDbFile: join(stateDir, "history.sqlite"),
    }
    app = new Hono()
    const created = await createDeps(config, {}, app)
    disposables = created.disposables
    const { recordingsStore } = created.deps
    deleteRecording = vi.fn(recordingsStore.delete)
    recordingsStore.delete = deleteRecording
    await buildApp(app, config, created.deps, { broadcastConfigChanged: () => {} })
  }

  async function stop() {
    for (const disposable of disposables) await disposable.dispose({ sig: "SIGTERM" })
    disposables = []
  }

  beforeEach(async () => {
    disposables = []
    stateDir = await mkdtemp(join(tmpdir(), "dc-recordings-delete-"))
    baseDir = join(stateDir, "recordings")
    vi.stubEnv("DC_MASTER_KEY", master)
    await boot()
  })

  afterEach(async () => {
    await stop()
    vi.unstubAllEnvs()
    await rm(stateDir, { recursive: true, force: true })
  })

  async function upload(token?: string): Promise<string> {
    const headers = new Headers({ "Content-Type": "application/json" })
    if (token !== undefined) headers.set(SCOPE_HEADER, token)
    const response = await app.request("/api/recordings", {
      method: "POST",
      headers,
      body: JSON.stringify({ audioBase64: bytes.toString("base64"), mimeType: "audio/mpeg" }),
    })
    expect(response.status).toBe(201)
    return (await response.json()).id
  }

  function remove(id: string, token?: string) {
    return app.request(route(id), {
      method: "DELETE",
      headers: token === undefined ? undefined : { [SCOPE_HEADER]: token },
    })
  }

  it("unlinks one of two uploaded clips and preserves the result after reopening", async () => {
    const deletedId = await upload()
    const keptId = await upload()
    const file = join(baseDir, `${deletedId}.mp3`)
    expect(await readFile(file)).toEqual(bytes)
    expect((await app.request(route(deletedId))).status).toBe(200)

    const response = await remove(deletedId)
    expect(response.status).toBe(204)
    expect(await response.text()).toBe("")

    await stop()
    await boot()
    expect((await app.request(route(deletedId))).status).toBe(404)
    await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" })
    const kept = await app.request(route(keptId))
    expect(kept.status).toBe(200)
    expect(Buffer.from(await kept.arrayBuffer())).toEqual(bytes)
    expect((await remove(deletedId)).status).toBe(204)
    expect((await remove(randomUUID())).status).toBe(204)
  })

  it.each([
    { header: "missing", token: undefined },
    { header: "empty", token: "" },
    { header: "spaces", token: "   " },
    { header: "master", token: master },
  ])("admits the operator with the $header scope header", async ({ token }) => {
    const id = await upload()
    expect((await remove(id, token)).status).toBe(204)
    expect(deleteRecording).toHaveBeenCalledExactlyOnceWith(id)
    await expect(readFile(join(baseDir, `${id}.mp3`))).rejects.toMatchObject({ code: "ENOENT" })
  })

  it.each(["scoped", "malformed"])("denies a %s token before storage", async (kind) => {
    const agentId = randomUUID()
    const token = kind === "scoped" ? issueToken(agentId) : "invalid-token"
    expect(verifyToken(token)).toEqual(kind === "scoped" ? { agentId } : undefined)
    const id = await upload(kind === "scoped" ? token : undefined)
    expect((await remove(id, token)).status).toBe(403)
    expect(deleteRecording).not.toHaveBeenCalled()
    expect(await readFile(join(baseDir, `${id}.mp3`))).toEqual(bytes)
    expect((await app.request(route(id))).status).toBe(200)
  })

  it("normalizes raw whitespace when the request implementation already trims headers", () => {
    const getHeader = vi.fn(() => " \t  ")
    expect(readScopeToken(getHeader)).toBeUndefined()
    expect(getHeader).toHaveBeenCalledExactlyOnceWith(SCOPE_HEADER)
  })

  it.each(["not-a-uuid", "__proto__", "../legacy.mp3"])(
    "rejects invalid recording id %s before storage",
    async (id) => {
      expect((await remove(id)).status).toBe(400)
      expect(deleteRecording).not.toHaveBeenCalled()
    },
  )

  it("completes parallel deletes and an upload using the same store instance", async () => {
    const first = await upload()
    const second = await upload()
    const [a, b, again, uploaded] = await Promise.all([
      remove(first),
      remove(second),
      remove(first),
      upload(),
    ])
    expect([a.status, b.status, again.status]).toEqual([204, 204, 204])
    expect((await app.request(route(first))).status).toBe(404)
    expect((await app.request(route(second))).status).toBe(404)
    expect((await app.request(route(uploaded))).status).toBe(200)
    const index = JSON.parse(await readFile(join(baseDir, "index.json"), "utf8"))
    expect(Object.keys(index.recordings)).toEqual([uploaded])
  })

  it("removes stale metadata when the recording file is already missing", async () => {
    const id = await upload()
    await unlink(join(baseDir, `${id}.mp3`))
    expect((await remove(id)).status).toBe(204)
    const index = JSON.parse(await readFile(join(baseDir, "index.json"), "utf8"))
    expect(index.recordings).toEqual({})
  })

  it("returns a generic 500 on unlink failure and keeps the entry for retry", async () => {
    const id = await upload()
    const file = join(baseDir, `${id}.mp3`)
    const indexFile = join(baseDir, "index.json")
    const previousIndex = await readFile(indexFile, "utf8")
    await unlink(file)
    await mkdir(file)
    const recordLog = vi.fn()
    const unsubscribe = addSink(recordLog)
    const failure = await remove(id).finally(unsubscribe)
    expect(failure.status).toBe(500)
    expect(await failure.json()).toEqual({ error: "could not delete recording" })
    expect(recordLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "error",
        ns: "backend.recordings",
        fields: { id, err: expect.objectContaining({ path: file, code: expect.any(String) }) },
      }),
    )
    expect(await readFile(indexFile, "utf8")).toBe(previousIndex)

    await rm(file, { recursive: true })
    await writeFile(file, bytes)
    expect((await remove(id)).status).toBe(204)
    await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("returns a generic 500 for a corrupt index without unlinking audio", async () => {
    const id = await upload()
    const indexFile = join(baseDir, "index.json")
    await writeFile(indexFile, "broken index")
    const failure = await remove(id)
    expect(failure.status).toBe(500)
    expect(await failure.json()).toEqual({ error: "could not delete recording" })
    expect(await readFile(indexFile, "utf8")).toBe("broken index")
    expect(await readFile(join(baseDir, `${id}.mp3`))).toEqual(bytes)
  })
})
