/**
 * pending-capture-store.test.ts — contract tests for PendingCaptureStore.
 * (slice voice-pending-persistence, Commit 0)
 */
import { describe, expect, it } from "vitest"
import type { PendingCapture } from "@drive-coding/core/voice/pending-capture"
import { createInMemoryPendingCaptureStore } from "./pending-capture-store"

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
