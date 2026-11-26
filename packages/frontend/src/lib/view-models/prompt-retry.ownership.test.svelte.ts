// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { PROMPT_CLAIM_MS, createFailedPromptStore } from "$lib/adapters/failed-prompt-store"
import { promptTestDb } from "$lib/components/chat/__tests__/type-area-harness.svelte"
import type { RecordTarget } from "$lib/engines/pending-capture-wiring"
import { promptOwner, promptPayload } from "$lib/engines/prompt-payload"
import type { PromptDispatchOutcome } from "$lib/session/prompt-dispatch"
import type { SessionView } from "$lib/session/session-view"
import { PromptRetry } from "./prompt-retry.svelte"

const base = "https://fixture.local"
const owner = (id: string) => promptOwner(base, "fixture", id)
const pending = new Set<PromptRetry>()
const aPayload = promptPayload("synthetic A", [
  { mimeType: "image/png", dataBase64: "QUFB" },
  { mimeType: "image/jpeg", dataBase64: "QkJC" },
], "")

function setup() {
  let now = 1
  const db = promptTestDb()
  const store = createFailedPromptStore(db, () => now)
  const reloadedStore = createFailedPromptStore(db, () => now)
  const transport = vi.fn<NonNullable<SessionView["promptTo"]>>()
    .mockResolvedValue({ kind: "accepted" })
  const entry = (id: string, generation: number): RecordTarget => ({
    ownerKey: owner(id), backendBaseUrl: base, generation, agentId: `agent-${generation}`,
    view: { promptTo: transport } as unknown as SessionView,
  })
  let active = $state.raw<RecordTarget | null>(entry("A", 1))
  const targets = {
    current: () => active,
    isCurrent: (target: RecordTarget) => active === target,
  }
  const onDispatch = vi.fn()
  const prompts = new PromptRetry(targets, onDispatch, store, () => now)
  pending.add(prompts)
  const reload = new PromptRetry(targets, vi.fn(), reloadedStore, () => now)
  pending.add(reload)
  return {
    store, reloadedStore, prompts, reload, transport, targets, onDispatch,
    move(id: string, generation: number) { active = entry(id, generation) },
    advance(ms: number) { now += ms },
  }
}

afterEach(() => {
  for (const prompts of pending) prompts.dispose()
  pending.clear()
})

describe("owned prompt delivery", () => {
  it("keeps a pending attempt across reload, then exposes only A's rejection and retries exact blocks", async () => {
    const { store, prompts, reload, transport, targets, move, onDispatch } = setup()
    const network = Promise.withResolvers<PromptDispatchOutcome>()
    transport.mockReturnValueOnce(network.promise)
    expect(await prompts.adopt(targets.current()!, aPayload)).toBe(true)
    await vi.waitFor(() => expect(transport).toHaveBeenCalledOnce())
    await reload.refresh()
    expect(reload.record?.payload).toEqual(aPayload)
    expect(reload.message).toBe("chat.prompt.deliveryUnknown")
    expect(reload.action).toBeUndefined()
    expect(reload.claimActive).toBe(true)

    move("B", 2)
    await prompts.refresh()
    network.resolve({
      kind: "rejected", reason: "session-mismatch", retryable: true, error: "synthetic 409",
    })
    await vi.waitFor(async () => expect((await store.load(owner("A")))?.reason).toBe("session-mismatch"))
    expect(prompts.record).toBeUndefined()
    expect(onDispatch).not.toHaveBeenCalled()

    move("A", 3)
    await reload.refresh()
    expect(reload.message).toBe("chat.prompt.sessionMismatch")
    const rejected = reload.record!
    await Promise.all([reload.retry(rejected), prompts.retry(rejected)])
    await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(2))
    expect(transport.mock.calls[0]).toEqual(transport.mock.calls[1])
    expect(transport.mock.calls[1]?.[2]).toEqual({ recordingId: "" })
    await vi.waitFor(async () => expect(await store.load(owner("A"))).toBeUndefined())
  })

  it.each([false, true])("keeps the Record receipt and payload when the live guard stops after commit (expired=%s)", async (expired) => {
    const { store, reloadedStore, prompts, transport, targets, advance, move } = setup()
    const committed = Promise.withResolvers<void>()
    const resume = Promise.withResolvers<void>()
    const realAdopt = store.adopt
    vi.spyOn(store, "adopt").mockImplementation(async (...args) => {
      const result = await realAdopt(...args)
      committed.resolve()
      await resume.promise
      return result
    })
    const submission = prompts.adopt(targets.current()!, aPayload, { recordCaptureId: "record-1" })
    await committed.promise
    expect(await reloadedStore.hasRecordReceipt(owner("A"), "record-1")).toBe(true)
    if (expired) advance(PROMPT_CLAIM_MS)
    move("B", 2)
    resume.resolve()
    expect(await submission).toBe(true)
    await vi.waitFor(async () => {
      const stored = await store.load(owner("A"))
      expect(stored).toMatchObject({
        payload: aPayload,
        delivery: expired ? "unknown" : "not-started",
      })
      if (expired) expect(stored).toHaveProperty("claimUntil", 1 + PROMPT_CLAIM_MS)
      else expect(stored).not.toHaveProperty("claimUntil")
    })
    expect(transport).not.toHaveBeenCalled()
    expect(prompts.record).toBeUndefined()
  })

  it("reports failures before dispatch and keeps the durable unknown on failed settlement", async () => {
    const { prompts, store, transport, targets, reload } = setup()
    vi.spyOn(store, "adopt").mockRejectedValueOnce(new Error("synthetic quota"))
    expect(await prompts.adopt(targets.current()!, aPayload)).toBe(false)
    expect(transport).not.toHaveBeenCalled()
    expect(prompts.error).toBe("chat.prompt.storageError")
    vi.spyOn(store, "settle").mockRejectedValueOnce(new Error("synthetic write failure"))
    expect(await prompts.adopt(targets.current()!, aPayload)).toBe(true)
    await vi.waitFor(() => expect(prompts.error).toBe("chat.prompt.storageError"))
    await reload.refresh()
    expect(reload.record?.payload).toEqual(aPayload)
    expect(reload.action).toBeUndefined()
  })

  it("drops an earlier hydration after A→B→A and ignores a stale attempted dismissal", async () => {
    const { store, reloadedStore, reload, move } = setup()
    const staleRead = Promise.withResolvers<Awaited<ReturnType<typeof store.load>>>()
    const stale = await store.adopt(owner("A"), aPayload)
    if (stale.kind !== "claimed") throw new Error("Missing fixture claim")
    vi.spyOn(reloadedStore, "load").mockReturnValueOnce(staleRead.promise)
    const old = reload.refresh()
    move("B", 2)
    await reload.refresh()
    await store.settle(stale.record, { delivery: "accepted" })
    const latest = await store.adopt(owner("A"), promptPayload("replacement"))
    if (latest.kind !== "claimed") throw new Error("Missing replacement")
    move("A", 3)
    await reload.refresh()
    staleRead.resolve(stale.record)
    await old
    await reload.dismiss(stale.record)
    expect(reload.record?.payload.text).toBe("replacement")
  })
})
