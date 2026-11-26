/**
 * pending-capture-recovery.test.ts — PendingCaptureRecovery engine tests.
 * (slice voice-pending-persistence, Commit 2)
 */
import type { PendingCapture, PendingCaptureStore } from "@drive-coding/core/voice/pending-capture"
import { describe, expect, it, vi } from "vitest"
import { PendingCaptureRecovery, type TranscribeContext } from "./pending-capture-recovery"

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

function createMockStore(initial: { capture: PendingCapture; blob: Blob } | null = null) {
  let slot = initial
  const store: PendingCaptureStore = {
    load: vi.fn(async () => (slot ? { capture: { ...slot.capture }, blob: slot.blob } : null)),
    save: vi.fn(async (capture, blob) => {
      slot = { capture: { ...capture }, blob }
    }),
    updateMeta: vi.fn(async (id, patch) => {
      if (slot && slot.capture.id === id) {
        slot.capture = { ...slot.capture, ...patch }
      }
    }),
    remove: vi.fn(async (id) => {
      if (slot?.capture.id === id) slot = null
    }),
  }
  return { store, getSlot: () => slot }
}

describe("PendingCaptureRecovery", () => {
  it("processBlob saves immediately then transcribes on success", async () => {
    const { store } = createMockStore()
    const recovery = new PendingCaptureRecovery(store, {
      source: "mic",
      transcribeErrorKey: "mic.error.transcribe",
    })
    const transcribe = vi.fn().mockResolvedValue({ text: "hello", recordingId: "rec-1" })
    const onSend = vi.fn()

    const outcome = await recovery.processBlob(new Blob(["audio"]), "audio/webm", {
      transcribe,
      onSend,
    })

    expect(outcome).toEqual({ ok: true, text: "hello", recordingId: "rec-1" })
    expect(store.save).toHaveBeenCalledOnce()
    expect(transcribe).toHaveBeenCalledOnce()
    expect(onSend).toHaveBeenCalledWith("hello", "rec-1")
    expect(store.remove).toHaveBeenCalledOnce()
    expect(recovery.hasPending).toBe(false)
  })

  it("processBlob keeps pending and sets lastError on transcribe failure", async () => {
    const { store } = createMockStore()
    const recovery = new PendingCaptureRecovery(store, {
      source: "mic",
      transcribeErrorKey: "mic.error.transcribe",
    })
    const transcribe = vi.fn().mockRejectedValue(new Error("403"))

    const outcome = await recovery.processBlob(new Blob(["audio"]), "audio/webm", { transcribe })

    expect(outcome).toEqual({ ok: false, error: "mic.error.transcribe" })
    expect(recovery.hasPending).toBe(true)
    expect(store.updateMeta).toHaveBeenCalledWith(expect.any(String), {
      lastError: "mic.error.transcribe",
    })
    expect(store.remove).not.toHaveBeenCalled()
  })

  it("hydrate with transcribedText then retry skips ctx.transcribe", async () => {
    const blob = new Blob(["audio"])
    const capture = sampleCapture({
      transcribedText: "cached text",
      recordingId: "rec-cached",
    })
    const { store } = createMockStore({ capture, blob })
    const recovery = new PendingCaptureRecovery(store, {
      source: "mic",
      transcribeErrorKey: "mic.error.transcribe",
    })

    await recovery.hydrate()
    const transcribe = vi.fn()
    const onSend = vi.fn()

    const outcome = await recovery.retry({ transcribe, onSend })

    expect(outcome).toEqual({ ok: true, text: "cached text", recordingId: "rec-cached" })
    expect(transcribe).not.toHaveBeenCalled()
    expect(onSend).toHaveBeenCalledWith("cached text", "rec-cached")
  })

  it("hydrate ignores pending from another source", async () => {
    const { store } = createMockStore({
      capture: sampleCapture({ source: "dictate" }),
      blob: new Blob(["audio"]),
    })
    const recovery = new PendingCaptureRecovery(store, {
      source: "mic",
      transcribeErrorKey: "mic.error.transcribe",
    })

    await expect(recovery.hydrate()).resolves.toBeNull()
    expect(recovery.hasPending).toBe(false)
  })

  it("dismiss removes pending from store", async () => {
    const { store } = createMockStore({
      capture: sampleCapture({ id: "cap-1" }),
      blob: new Blob(["audio"]),
    })
    const recovery = new PendingCaptureRecovery(store, {
      source: "mic",
      transcribeErrorKey: "mic.error.transcribe",
    })

    await recovery.hydrate()
    await recovery.dismiss()

    expect(store.remove).toHaveBeenCalledWith("cap-1")
    expect(recovery.hasPending).toBe(false)
  })

  it.each([false, true])("awaits durable handoff before removing the capture (adopted=%s)", async (adopted) => {
    const { store } = createMockStore()
    const recovery = new PendingCaptureRecovery(store, {
      source: "mic",
      transcribeErrorKey: "mic.error.transcribe",
    })
    const handoff = Promise.withResolvers<boolean>()
    const onSend = vi.fn(() => handoff.promise)
    const outcome = recovery.processBlob(new Blob(["audio"]), "audio/webm", {
      transcribe: vi.fn().mockResolvedValue({ text: "hi", recordingId: "" }),
      onSend,
    })
    await vi.waitFor(() => expect(onSend).toHaveBeenCalledWith("hi", ""))
    expect(store.remove).not.toHaveBeenCalled()
    handoff.resolve(adopted)
    await expect(outcome).resolves.toEqual({ ok: true, text: "hi", recordingId: "" })
    expect(recovery.hasPending).toBe(!adopted)
    expect(store.remove).toHaveBeenCalledTimes(adopted ? 1 : 0)
  })

  it.each(["", "   "])("passes empty Dictate results to the opt-in handoff and reuses them", async (text) => {
    const { store } = createMockStore()
    const recovery = new PendingCaptureRecovery(store, {
      source: "dictate",
      transcribeErrorKey: "dictate.error.transcribe",
    })
    const transcribe = vi.fn().mockResolvedValue({ text, recordingId: "" })
    const onSend = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const context = { transcribe, onSend, handoffEmpty: true }
    await recovery.processBlob(new Blob(["audio"]), "audio/webm", context)
    expect(recovery.capture?.transcribedText).toBe(text)
    expect(store.remove).not.toHaveBeenCalled()
    await recovery.retry(context)
    expect(transcribe).toHaveBeenCalledOnce()
    expect(onSend).toHaveBeenCalledTimes(2)
    expect(store.remove).toHaveBeenCalledOnce()
  })
})

describe("Record handoff verification", () => {
  it.each(["replacement", "dismiss", "cached"] as const)(
    "rechecks the exact item synchronously after disk verification (%s)",
    async (scenario) => {
      const cached = scenario === "cached"
      const blob = new Blob(["audio"])
      const { store, getSlot } = createMockStore({
        capture: sampleCapture(cached ? { transcribedText: "cached", recordingId: "old" } : {}),
        blob,
      })
      const recovery = new PendingCaptureRecovery(store, {
        source: "mic",
        transcribeErrorKey: "mic.error.transcribe",
      })
      await recovery.hydrate()
      const disk = Promise.withResolvers<boolean>()
      let valid = true
      const onSend = vi.fn()
      const verifyHandoff = vi.fn(() => disk.promise)
      const transcribe = vi.fn().mockResolvedValue({ text: "fixture", recordingId: "rec" })
      const pending = recovery.retry({
        transcribe,
        onSend,
        isCaptureCurrent: (id) => valid && id === "cap-1",
        verifyHandoff,
      })
      await vi.waitFor(() => expect(verifyHandoff).toHaveBeenCalledWith("cap-1"))

      disk.resolve(true)
      valid = false
      if (scenario === "replacement") await store.save(sampleCapture({ id: "new" }), blob)
      else await store.remove("cap-1")
      await pending

      expect(onSend).not.toHaveBeenCalled()
      expect(getSlot()?.capture.id).toBe(scenario === "replacement" ? "new" : undefined)
      expect(transcribe).toHaveBeenCalledTimes(cached ? 0 : 1)
      expect(store.remove).toHaveBeenCalledTimes(scenario === "replacement" ? 0 : 1)
    },
  )

  it("retains the new text when the final synchronous guard rejects the handoff", async () => {
    const { store, getSlot } = createMockStore()
    const recovery = new PendingCaptureRecovery(store, {
      source: "mic",
      transcribeErrorKey: "mic.error.transcribe",
    })
    await recovery.processBlob(new Blob(["audio"]), "audio/webm", {
      transcribe: vi.fn().mockResolvedValue({ text: "retained", recordingId: "rec" }),
      verifyHandoff: vi.fn().mockResolvedValue(true),
      onSend: () => false,
    })
    expect(getSlot()?.capture).toMatchObject({ transcribedText: "retained", recordingId: "rec" })
    expect(store.remove).not.toHaveBeenCalled()
  })

  it("removes whitespace-only transcriptions without dispatch", async () => {
    const { store, getSlot } = createMockStore()
    const recovery = new PendingCaptureRecovery(store, {
      source: "mic",
      transcribeErrorKey: "mic.error.transcribe",
    })
    const verifyHandoff = vi.fn()
    const onSend = vi.fn()
    await recovery.processBlob(new Blob(["audio"]), "audio/webm", {
      transcribe: vi.fn().mockResolvedValue({ text: "   ", recordingId: "rec" }),
      verifyHandoff,
      onSend,
    })
    expect(getSlot()).toBeNull()
    expect(verifyHandoff).not.toHaveBeenCalled()
    expect(onSend).not.toHaveBeenCalled()
  })
})
