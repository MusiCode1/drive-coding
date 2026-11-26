/**
 * pending-capture-store.test.ts — contract tests for PendingCaptureStore.
 * (slice voice-pending-persistence, Commit 0)
 */

import type { PendingCapture } from "@drive-coding/core/voice/pending-capture"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PendingCaptureRecovery } from "../engines/pending-capture-recovery"
import { ComposerDraft } from "../view-models/composer-draft.svelte"
import { Dictate } from "../view-models/dictate.svelte"
import type { Mic } from "../view-models/mic.svelte"
import {
  createInMemoryPendingCaptureStore,
  createPendingCaptureStore,
} from "./pending-capture-store"

function sampleCapture(overrides: Partial<PendingCapture> = {}): PendingCapture {
  return {
    id: "cap-1",
    source: "mic",
    mimeType: "audio/webm",
    createdAt: "2026-09-01T12:00:00.000Z",
    recordingId: "",
    ...overrides,
  }
}

describe("createInMemoryPendingCaptureStore", () => {
  it("load returns null when empty", async () => {
    const store = createInMemoryPendingCaptureStore()
    await expect(store.load()).resolves.toBeNull()
  })

  it("save + load round-trips capture and blob", async () => {
    const store = createInMemoryPendingCaptureStore()
    const capture = sampleCapture()
    const blob = new Blob(["audio"], { type: "audio/webm" })

    await store.save(capture, blob)
    const loaded = await store.load()

    expect(loaded).not.toBeNull()
    expect(loaded?.capture).toEqual(capture)
    expect(await loaded!.blob.text()).toBe("audio")
  })

  it("save replaces the previous slot (single slot)", async () => {
    const store = createInMemoryPendingCaptureStore()
    await store.save(sampleCapture({ id: "first" }), new Blob(["a"]))
    await store.save(sampleCapture({ id: "second" }), new Blob(["b"]))

    const loaded = await store.load()
    expect(loaded?.capture.id).toBe("second")
    expect(await loaded!.blob.text()).toBe("b")
  })

  it("updateMeta patches fields for the saved id", async () => {
    const store = createInMemoryPendingCaptureStore()
    const capture = sampleCapture({ id: "cap-1" })
    await store.save(capture, new Blob(["audio"]))

    await store.updateMeta("cap-1", {
      recordingId: "rec-42",
      transcribedText: "hello",
      lastError: "mic.error.transcribe",
    })

    const loaded = await store.load()
    expect(loaded?.capture.recordingId).toBe("rec-42")
    expect(loaded?.capture.transcribedText).toBe("hello")
    expect(loaded?.capture.lastError).toBe("mic.error.transcribe")
  })

  it("updateMeta is a no-op for unknown id", async () => {
    const store = createInMemoryPendingCaptureStore()
    await store.save(sampleCapture({ id: "cap-1" }), new Blob(["audio"]))

    await store.updateMeta("other", { recordingId: "x" })

    const loaded = await store.load()
    expect(loaded?.capture.recordingId).toBe("")
  })

  it("remove clears the slot for matching id", async () => {
    const store = createInMemoryPendingCaptureStore()
    await store.save(sampleCapture({ id: "cap-1" }), new Blob(["audio"]))

    await store.remove("cap-1")

    await expect(store.load()).resolves.toBeNull()
  })

  it("remove ignores non-matching id", async () => {
    const store = createInMemoryPendingCaptureStore()
    await store.save(sampleCapture({ id: "cap-1" }), new Blob(["audio"]))

    await store.remove("other")

    await expect(store.load()).resolves.not.toBeNull()
  })
})

describe("legacy voice database", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("updates Dictate in a single transaction and preserves legacy mic metadata and audio", async () => {
    const legacy = sampleCapture({ id: "legacy", transcribedText: "owner unknown" })
    const old = sampleCapture({ id: "old", source: "dictate" })
    const first = new Blob(["legacy"])
    const second = new Blob(["old"])
    const meta = new Map<string, PendingCapture>([
      [legacy.id, legacy],
      [old.id, old],
    ])
    const blobs = new Map<string, Blob>([
      [legacy.id, first],
      [old.id, second],
    ])
    const request = <T>(result: T) => {
      const req = { result, onsuccess: () => {} }
      queueMicrotask(() => req.onsuccess())
      return req
    }
    const transaction = vi.fn(() => {
      const tx = {
        oncomplete: () => {},
        objectStore: (name: string) =>
          name === "meta"
            ? {
                get: (key: string) => request(meta.get(key)),
                getAll: () => request([...meta.values()]),
                put: (row: PendingCapture) => meta.set(row.id, row),
                delete: (key: string) => meta.delete(key),
              }
            : {
                get: (key: string) => request(blobs.get(key)),
                put: (blob: Blob, key: string) => blobs.set(key, blob),
                delete: (key: string) => blobs.delete(key),
              },
      }
      setTimeout(() => tx.oncomplete(), 0)
      return tx
    })
    vi.stubGlobal("indexedDB", { open: () => request({ transaction }) })

    const store = createPendingCaptureStore()
    expect(await store.load()).toEqual({ capture: old, blob: second })
    transaction.mockClear()
    const fresh = sampleCapture({ id: "fresh", source: "dictate", transcribedText: "draft text" })
    const audio = new Blob(["new"])
    await store.save(fresh, audio)
    expect(transaction).toHaveBeenCalledExactlyOnceWith(["meta", "blobs"], "readwrite")
    expect(await store.load()).toEqual({ capture: fresh, blob: audio })
    await store.updateMeta(legacy.id, { transcribedText: "changed" })
    await store.remove(legacy.id)
    await store.remove(fresh.id)
    expect(await store.load()).toBeNull()
    expect([...meta]).toEqual([[legacy.id, legacy]])
    expect([...blobs]).toEqual([[legacy.id, first]])
  })

  it("appends cached Dictate text once and removes the consumed recovery", async () => {
    const store = createInMemoryPendingCaptureStore()
    const capture = sampleCapture({ source: "dictate", transcribedText: "cached dictation" })
    await store.save(capture, new Blob(["dictation"]))
    const draft = new ComposerDraft()
    const recovery = new PendingCaptureRecovery(store, {
      source: "dictate",
      transcribeErrorKey: "dictate.error.transcribe",
    })
    const mic = {} as Mic
    const dictate = new Dictate({ draft, mic, recovery })
    await dictate.hydratePending()
    await dictate.retryTranscribe()
    await dictate.retryTranscribe()
    expect(draft.text).toBe("cached dictation")
    expect(await store.load()).toBeNull()
  })
})
