import type { PendingCapture } from "@drive-coding/core/voice/pending-capture"
import { afterEach, describe, expect, it, vi } from "vitest"
import * as adapter from "./record-capture-store"

const blob = new Blob(["fixture audio"], { type: "audio/webm" })
const capture = (id: string): PendingCapture => ({
  id,
  source: "mic",
  createdAt: "2026-11-26T00:00:00Z",
  mimeType: blob.type,
  recordingId: "",
})

function disk() {
  const rows = new Map<IDBValidKey, unknown>()
  const fail = { open: false, read: false, write: false }
  const database = {
    transaction(_name: string, mode: IDBTransactionMode) {
      if (mode === "readonly" ? fail.read : fail.write) throw new Error("test transaction failure")
      const tx = { oncomplete: () => {}, objectStore: () => store }
      const store = {
        get(key: IDBValidKey) {
          const request = { result: rows.get(key), onsuccess: () => {} }
          queueMicrotask(() => request.onsuccess())
          return request
        },
        put(value: unknown, key: IDBValidKey) {
          rows.set(key, value)
        },
        delete(key: IDBValidKey) {
          rows.delete(key)
        },
      }
      // Request callbacks run inside their transaction before it completes.
      queueMicrotask(() => queueMicrotask(() => tx.oncomplete()))
      return tx
    },
  }
  const open = vi.fn(() => {
    const request = { result: database, onsuccess: () => {}, onerror: () => {} }
    queueMicrotask(() => (fail.open ? request.onerror() : request.onsuccess()))
    return request
  })
  vi.stubGlobal("indexedDB", { open })
  return { rows, fail, open }
}

const A = JSON.stringify(["https://a.local", "fixture", "session"])
const B = JSON.stringify(["https://b.local", "fixture", "session"])

afterEach(() => vi.unstubAllGlobals())

describe("Record capture slots", () => {
  it("keeps payloads separate across scopes and reload, including quarantine", async () => {
    disk()
    expect(adapter).toHaveProperty("createRecordCaptureStore")
    const store = adapter.createRecordCaptureStore()
    await store.forOwner(A).save(capture("x"), blob)
    expect(await store.forOwner(B).load()).toBeNull()
    await store.forOwner(B).save(capture("y"), blob)
    await store.forOwner(null).save(capture("z"), blob)

    const reload = adapter.createRecordCaptureStore()
    expect(await reload.forOwner(A).load()).toEqual({ capture: capture("x"), blob })
    expect(await reload.forOwner(B).load()).toEqual({ capture: capture("y"), blob })
    expect(await reload.forOwner(null).load()).toEqual({ capture: capture("z"), blob })
  })

  it("applies disk update and removal only to the expected owner and id", async () => {
    const { rows } = disk()
    const store = adapter.createRecordCaptureStore()
    const a = store.forOwner(A)
    await a.save(capture("x"), blob)
    await adapter.createRecordCaptureStore().forOwner(A).save(capture("y"), blob)
    await a.updateMeta("x", { recordingId: "stale" })
    await a.remove("x")
    expect(await a.matches("x")).toBe(false)
    expect(await a.load()).toEqual({ capture: capture("y"), blob })

    rows.set(B, rows.get(A))
    expect(await store.forOwner(B).load()).toBeNull()
    await store.forOwner(B).remove("y")
    expect(rows.has(B)).toBe(true)

    await a.updateMeta("y", { recordingId: "valid" })
    expect((await a.load())?.capture.recordingId).toBe("valid")
    await a.remove("y")
    expect(await adapter.createRecordCaptureStore().forOwner(A).load()).toBeNull()
  })

  it("keeps a RAM replacement and tombstone authoritative after disk recovery", async () => {
    const { fail } = disk()
    const a = adapter.createRecordCaptureStore().forOwner(A)
    await a.save(capture("x"), blob)
    fail.write = true
    await a.save(capture("y"), blob)
    fail.write = false
    expect(await a.matches("y")).toBe(true)
    await a.updateMeta("y", { transcribedText: "cached" })
    expect((await a.load())?.capture.transcribedText).toBe("cached")
    await a.remove("y")
    expect(await a.load()).toBeNull()
    expect(await a.matches("x")).toBe(false)
    expect((await adapter.createRecordCaptureStore().forOwner(A).load())?.capture.id).toBe("x")

    await a.save(capture("z"), blob)
    await adapter.createRecordCaptureStore().forOwner(A).save(capture("newer"), blob)
    expect((await a.load())?.capture.id).toBe("newer")
  })

  it("keeps a failed remove hidden in this tab and permits reopening IDB", async () => {
    const { fail, open } = disk()
    const a = adapter.createRecordCaptureStore().forOwner(A)
    fail.open = true
    await a.save(capture("x"), blob)
    expect(await a.matches("x")).toBe(true)
    fail.open = false
    await a.save(capture("y"), blob)
    expect(open).toHaveBeenCalledTimes(2)
    fail.write = true
    await a.remove("y")
    fail.write = false
    expect(await a.load()).toBeNull()
    expect((await adapter.createRecordCaptureStore().forOwner(A).load())?.capture.id).toBe("y")
  })

  it("conditionally removes a restored capture while keeping a newer recording", async () => {
    disk()
    const original = adapter.createRecordCaptureStore().forOwner(A)
    const reloaded = adapter.createRecordCaptureStore().forOwner(A)
    await original.save(capture("transferred"), blob)
    expect(await reloaded.matches("transferred")).toBe(true)
    await original.save(capture("new-recording"), blob)
    await reloaded.remove("transferred")
    expect((await adapter.createRecordCaptureStore().forOwner(A).load())?.capture.id).toBe("new-recording")
  })

  it("may show a last read on disk failure and requires a fresh read for handoff", async () => {
    const { fail } = disk()
    const a = adapter.createRecordCaptureStore().forOwner(A)
    await a.save(capture("x"), blob)
    expect(await a.matches("x")).toBe(true)
    fail.read = true
    expect((await a.load())?.capture.id).toBe("x")
    expect(await a.matches("x")).toBe(false)
  })
})
