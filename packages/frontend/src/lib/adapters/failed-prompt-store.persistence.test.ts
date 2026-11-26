// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { promptTestDb } from "../components/chat/__tests__/type-area-harness.svelte"
import { buildPrompt, promptOwner, promptPayload } from "../engines/prompt-payload"
import { createDictateSubmitSourceDb } from "./dictate-submit-source"
import { PROMPT_CLAIM_MS, createFailedPromptStore } from "./failed-prompt-store"
import { PROMPT_STORE, createPromptRecoveryDb } from "./prompt-recovery-idb"

const a = promptOwner("https://fixture.local", "fixture", "A")
const b = promptOwner("https://other-fixture.local", "fixture", "A")
const payload = promptPayload(
  "synthetic text",
  [
    { mimeType: "image/png", dataBase64: "QUFB" },
    { mimeType: "image/jpeg", dataBase64: "QkJC" },
  ],
  "",
)

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("saved prompts", () => {
  it("serializes two owners of one slot, keeps order and the empty recordingId across reload", async () => {
    const db = promptTestDb()
    const one = createFailedPromptStore(db)
    const two = createFailedPromptStore(db)
    const [claimed, competing] = await Promise.all([one.adopt(a, payload), two.adopt(a, payload)])
    expect(claimed.kind).toBe("claimed")
    expect(competing.kind).toBe("occupied")
    if (claimed.kind !== "claimed") throw new Error("Missing claim")
    expect(await two.load(b)).toBeUndefined()
    expect(await two.load(promptOwner("https://fixture.local", "other-cli", "A"))).toBeUndefined()
    expect(await two.load(a)).toMatchObject({ delivery: "unknown", payload })
    expect(await two.dismiss(claimed.record)).toBe(false)
    expect(await two.retry(claimed.record)).toBeUndefined()
    await one.settle(claimed.record, {
      delivery: "rejected",
      reason: "session-mismatch",
      retryable: true,
    })
    const reopened = await two.load(a)
    if (!reopened) throw new Error("Missing replacement")
    const [retry, other] = await Promise.all([two.retry(reopened), one.retry(reopened)])
    expect(other).toBeUndefined()
    if (!retry) throw new Error("Missing retry")
    expect(buildPrompt(retry.payload)).toEqual(buildPrompt(payload))
    expect(buildPrompt(retry.payload).meta).toEqual({ recordingId: "" })
    expect((await two.load(a))?.delivery).toBe("unknown")
    expect(await one.settle(claimed.record, { delivery: "accepted" })).toBe(false)
    expect(await one.dismiss(reopened)).toBe(false)
    expect(await two.settle(retry, { delivery: "accepted" })).toBe(true)
    expect(await one.load(a)).toBeUndefined()
  })

  it("retains receipts after release, dismissal and other captures; tombstones prevent reuse", async () => {
    vi.stubGlobal("IDBKeyRange", { bound: (lower: unknown) => ({ lower }) })
    const db = promptTestDb()
    let now = 1
    const one = createFailedPromptStore(db, () => now)
    const two = createFailedPromptStore(db, () => now)
    const capture = { recordCaptureId: "record-A" }
    const first = await one.adopt(a, payload, capture)
    if (first.kind !== "claimed") throw new Error("Missing Record claim")
    expect(await two.hasRecordReceipt(a, "record-A")).toBe(true)
    now += PROMPT_CLAIM_MS
    expect(await one.settle(first.record, { delivery: "not-started" })).toBe(false)
    expect(await two.load(a)).toMatchObject({ delivery: "unknown", payload })
    expect(await two.dismiss(first.record)).toBe(true)
    expect(await one.adopt(a, payload, capture)).toEqual({ kind: "already-adopted" })
    const next = await one.adopt(a, payload, { recordCaptureId: "record-B" })
    if (next.kind !== "claimed") throw new Error("Missing new Record claim")
    expect(await one.settle(next.record, { delivery: "accepted" })).toBe(true)
    expect(await two.hasRecordReceipt(a, "record-A")).toBe(true)
    expect(await two.hasRecordReceipt(a, "record-B")).toBe(true)
    expect(await two.deleteOwner(a)).toBe(true)
    expect(await two.hasRecordReceipt(a, "record-A")).toBe(false)
    expect(await one.adopt(a, payload, { recordCaptureId: "record-C" })).toEqual({ kind: "stale" })
    expect(await one.settle(next.record, { delivery: "accepted" })).toBe(false)
    expect(await one.adopt(b, payload, capture)).toMatchObject({ kind: "claimed" })
  })

  it("consumes exactly the Dictate source version in the claim transaction", async () => {
    const db = promptTestDb()
    const sources = createDictateSubmitSourceDb(db)
    const one = createFailedPromptStore(db)
    const two = createFailedPromptStore(db)
    const initial = await sources.save({
      owner: a,
      snapshot: payload,
      version: 1,
      capture: {
        source: "dictate",
        id: "audio-A",
        recordingId: "",
        mimeType: "audio/webm",
        createdAt: "fixture",
      },
      blob: new Blob(["fixture"]),
    })
    const ready = await sources.save(
      {
        ...initial,
        capture: { ...initial.capture, transcribedText: "synthetic speech" },
      },
      initial.version,
    )
    expect(
      await one.adopt(a, payload, { dictate: { id: "audio-A", version: initial.version } }),
    ).toEqual({ kind: "stale" })
    const origin = { dictate: { id: "audio-A", version: ready.version } }
    const claim = await one.adopt(a, payload, origin)
    if (claim.kind !== "claimed") throw new Error("Missing Dictate claim")
    expect(await sources.load(a)).toBeUndefined()
    await one.settle(claim.record, { delivery: "accepted" })
    expect(await two.adopt(a, payload, origin)).toEqual({ kind: "stale" })
    await expect(sources.save(ready, ready.version)).rejects.toThrow("source changed")
  })
})

describe("prompt IndexedDB operation deadline", () => {
  it("rejects blocked and late opens, closes late handles and permits a fresh open", async () => {
    vi.useFakeTimers()
    const requests = Array.from({ length: 3 }, () => ({
      onblocked: () => {},
      onsuccess: () => {},
      result: { close: vi.fn() },
    }))
    const open = vi
      .fn()
      .mockReturnValueOnce(requests[0])
      .mockReturnValueOnce(requests[1])
      .mockReturnValueOnce(requests[2])
    vi.stubGlobal("indexedDB", { open })
    const db = createPromptRecoveryDb()
    const load = () => db.transact("readonly", [{ store: PROMPT_STORE, key: a }], () => null)
    const blocked = expect(load()).rejects.toThrow("blocked")
    requests[0]?.onblocked()
    await blocked
    requests[0]?.onsuccess()
    expect(requests[0]?.result.close).toHaveBeenCalledOnce()
    const timedOut = expect(load()).rejects.toThrow("timed out")
    await vi.advanceTimersByTimeAsync(5_000)
    await timedOut
    requests[1]?.onsuccess()
    expect(requests[1]?.result.close).toHaveBeenCalledOnce()
    const reopened = expect(load()).rejects.toThrow("blocked")
    requests[2]?.onblocked()
    await reopened
    expect(open).toHaveBeenCalledTimes(3)
  })

  it("requires transaction completion and aborts a stuck transaction within the shared budget", async () => {
    vi.useFakeTimers()
    const get = { result: undefined, onsuccess: () => {} }
    const tx = {
      oncomplete: () => {},
      onabort: () => {},
      abort: vi.fn(),
      objectStore: () => ({ get: () => get }),
    }
    const result = { transaction: () => tx, close: vi.fn() }
    const request = { result, onsuccess: () => {} }
    vi.stubGlobal("indexedDB", { open: () => request })
    const db = createPromptRecoveryDb()
    const apply = vi.fn(() => "prepared")
    const load = () => db.transact("readwrite", [{ store: PROMPT_STORE, key: a }], apply)
    const complete = vi.fn()
    const first = load().then(complete)
    request.onsuccess()
    await Promise.resolve()
    get.onsuccess()
    await Promise.resolve()
    expect(apply).toHaveBeenCalledOnce()
    expect(complete).not.toHaveBeenCalled()
    tx.oncomplete()
    await first
    expect(complete).toHaveBeenCalledWith("prepared")

    const second = expect(load()).rejects.toThrow("timed out")
    await vi.advanceTimersByTimeAsync(5_000)
    await second
    expect(tx.abort).toHaveBeenCalledOnce()
    get.onsuccess()
    tx.oncomplete()
    expect(apply).toHaveBeenCalledOnce()
  })
})
