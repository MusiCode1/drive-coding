/**
 * pending-capture-recovery.test.ts — PendingCaptureRecovery engine tests.
 * (slice voice-pending-persistence, Commit 2)
 */
import type { PendingCapture, PendingCaptureStore } from "@drive-coding/core/voice/pending-capture"
import { describe, expect, it, vi } from "vitest"
import {
  PendingCaptureRecovery,
  type TranscribeContext,
} from "./pending-capture-recovery"

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

    const outcome = await recovery.processBlob(
      new Blob(["audio"]),
      "audio/webm",
      { transcribe, onSend },
    )

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

    const outcome = await recovery.processBlob(
      new Blob(["audio"]),
      "audio/webm",
      { transcribe },
    )

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

  it("onSend is not awaited (fire-and-forget from caller perspective)", async () => {
    const { store } = createMockStore()
    const recovery = new PendingCaptureRecovery(store, {
      source: "mic",
      transcribeErrorKey: "mic.error.transcribe",
    })
    let resolveSend!: () => void
    const onSend = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve
        }),
    )

    const outcomePromise = recovery.processBlob(new Blob(["audio"]), "audio/webm", {
      transcribe: vi.fn().mockResolvedValue({ text: "hi", recordingId: "" }),
      onSend,
    })

    await expect(outcomePromise).resolves.toEqual({ ok: true, text: "hi", recordingId: "" })
    expect(onSend).toHaveBeenCalledOnce()
    resolveSend()
  })
})
