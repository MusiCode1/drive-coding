// @vitest-environment jsdom
import { flushSync, mount, unmount } from "svelte"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createFailedPromptStore } from "$lib/adapters/failed-prompt-store"
import type { RecordTarget } from "$lib/engines/pending-capture-wiring"
import { promptOwner, promptPayload } from "$lib/engines/prompt-payload"
import type { SessionView } from "$lib/session/session-view"
import { PromptRetry } from "$lib/view-models/prompt-retry.svelte"
import Harness from "./chat-session-status-prompt-retry-harness.svelte"
import { promptTestDb } from "./type-area-harness.svelte"

let component: object | undefined
let vm: PromptRetry | undefined

afterEach(async () => {
  if (component) await unmount(component)
  vm?.dispose()
  document.body.replaceChildren()
})

describe("ChatSessionStatus saved prompts", () => {
  it("renders the exact mismatch, only in A, and retries the original image without bytes in the DOM", async () => {
    const store = createFailedPromptStore(promptTestDb())
    const base = "https://fixture.local"
    const promptTo = vi.fn().mockResolvedValue({ kind: "accepted" })
    const view = { promptTo } as unknown as SessionView
    const target = (id: string, generation: number): RecordTarget => ({
      ownerKey: promptOwner(base, "fixture", id), backendBaseUrl: base,
      generation, agentId: `fixture-${generation}`, view,
    })
    const a = target("A", 1)
    const claimed = await store.adopt(a.ownerKey, promptPayload("", [
      { mimeType: "image/png", dataBase64: "QUJDREVGRw==" },
    ]))
    if (claimed.kind !== "claimed") throw new Error("Missing fixture claim")
    await store.settle(claimed.record, { delivery: "rejected", reason: "session-mismatch", retryable: true })
    let active = target("B", 2)
    vm = new PromptRetry({ current: () => active, isCurrent: (entry) => entry === active }, vi.fn(), store)
    component = mount(Harness, { target: document.body, props: { prompts: vm } })

    await vm.refresh()
    flushSync()
    expect(document.body.textContent).not.toContain("לא נשלח — השיחה הוחלפה")
    active = target("A", 3)
    await vm.refresh()
    flushSync()
    const alert = document.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain("לא נשלח — השיחה הוחלפה")
    expect(alert?.querySelector('[dir="auto"]')?.textContent?.trim()).toBe("הודעה עם תמונות בלבד")
    expect(document.body.innerHTML).not.toContain("QUJDREVGRw==")
    const retry = [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "נסה לשלוח שוב")
    expect(retry).toBeDefined()
    retry?.click()
    await vi.waitFor(() => expect(promptTo).toHaveBeenCalledWith("A", [
      { type: "image", mimeType: "image/png", data: "QUJDREVGRw==" },
    ], undefined))
  })

  it("offers only dismissal for unknown delivery once its claim expires", async () => {
    const store = createFailedPromptStore(promptTestDb(), () => 0)
    const base = "https://fixture.local"
    const active: RecordTarget = {
      ownerKey: promptOwner(base, "fixture", "A"), backendBaseUrl: base,
      generation: 1, agentId: "agent-1", view: {} as SessionView,
    }
    const claimed = await store.adopt(active.ownerKey, promptPayload("synthetic body"))
    if (claimed.kind !== "claimed") throw new Error("Missing fixture claim")
    await store.settle(claimed.record, { delivery: "unknown" })
    vm = new PromptRetry({ current: () => active, isCurrent: () => true }, vi.fn(), store)
    component = mount(Harness, { target: document.body, props: { prompts: vm } })
    await vm.refresh()
    flushSync()
    const buttons = [...document.querySelectorAll("button")].map((button) => button.textContent?.trim())
    expect(buttons).toEqual(["סגור שגיאה"])
    expect(document.querySelector('[dir="auto"]')?.textContent?.trim()).toBe("synthetic body")
  })
})
