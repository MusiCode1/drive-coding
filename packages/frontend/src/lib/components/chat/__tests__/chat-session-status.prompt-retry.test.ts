// @vitest-environment jsdom
import { flushSync, mount, unmount } from "svelte"
import { fromStore, writable } from "svelte/store"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createFailedPromptStore, PROMPT_CLAIM_MS } from "$lib/adapters/failed-prompt-store"
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
      ownerKey: promptOwner(base, "fixture", id),
      backendBaseUrl: base,
      generation,
      agentId: `fixture-${generation}`,
      view,
    })
    const a = target("A", 1)
    const claimed = await store.adopt(
      a.ownerKey,
      promptPayload("", [{ mimeType: "image/png", dataBase64: "QUJDREVGRw==" }]),
    )
    if (claimed.kind !== "claimed") throw new Error("Missing fixture claim")
    await store.settle(claimed.record, {
      delivery: "rejected",
      reason: "session-mismatch",
      retryable: true,
    })
    const active = fromStore(writable(target("B", 2)))
    vm = new PromptRetry(
      {
        current: () => active.current,
        isCurrent: (entry) => entry === active.current,
      },
      vi.fn(),
      store,
    )
    component = mount(Harness, { target: document.body, props: { prompts: vm } })

    await vm.refresh()
    flushSync()
    expect(document.body.textContent).not.toContain("לא נשלח — השיחה הוחלפה")
    active.current = target("A", 3)
    await vm.refresh()
    flushSync()
    const alert = document.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain("לא נשלח — השיחה הוחלפה")
    expect(alert?.querySelector('[dir="auto"]')?.textContent?.trim()).toBe("הודעה עם תמונות בלבד")
    expect(document.body.innerHTML).not.toContain("QUJDREVGRw==")
    const retry = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "נסה לשלוח שוב",
    )
    expect(retry).toBeDefined()
    retry?.click()
    await vi.waitFor(() =>
      expect(promptTo).toHaveBeenCalledWith(
        "A",
        [{ type: "image", mimeType: "image/png", data: "QUJDREVGRw==" }],
        undefined,
      ),
    )
  })

  it("requires the exact warning and a separate confirmation after claim expiry", async () => {
    let now = 1
    const clock = () => now
    const store = createFailedPromptStore(promptTestDb(), clock)
    const base = "https://fixture.local"
    const promptTo = vi.fn().mockResolvedValue({ kind: "accepted" })
    const a: RecordTarget = {
      ownerKey: promptOwner(base, "fixture", "A"),
      backendBaseUrl: base,
      generation: 1,
      agentId: "agent-1",
      view: { promptTo } as unknown as SessionView,
    }
    const claimed = await store.adopt(a.ownerKey, promptPayload("synthetic body"))
    if (claimed.kind !== "claimed") throw new Error("Missing fixture claim")
    const active = fromStore(writable(a))
    vm = new PromptRetry(
      { current: () => active.current, isCurrent: (target) => target === active.current },
      vi.fn(),
      store,
      clock,
    )
    component = mount(Harness, { target: document.body, props: { prompts: vm } })
    await vm.refresh()
    flushSync()
    expect(document.querySelector('[role="alert"] [dir="auto"]')?.textContent?.trim()).toBe(
      "synthetic body",
    )
    expect(document.querySelectorAll("button")).toHaveLength(0)

    now += PROMPT_CLAIM_MS
    await vm.refresh()
    flushSync()
    const buttons = [...document.querySelectorAll("button")].map((button) =>
      button.textContent?.trim(),
    )
    expect(buttons).toEqual(["שלח שוב בכל זאת", "סגור שגיאה"])
    const findButton = (label: string) => {
      const button = [...document.querySelectorAll("button")].find(
        (element) => element.textContent?.trim() === label,
      )
      if (!button) throw new Error(`Missing button: ${label}`)
      return button
    }
    const click = (label: string) => {
      findButton(label).click()
      flushSync()
    }
    const confirmLabel = "אישור שליחה חוזרת"
    const captureClickErrors = (run: () => void) => {
      const errors: unknown[] = []
      const collect = (event: ErrorEvent) => {
        errors.push(event.error)
        event.preventDefault()
      }
      window.addEventListener("error", collect)
      try {
        run()
      } finally {
        window.removeEventListener("error", collect)
      }
      expect(errors).toEqual([])
    }
    const warning =
      "ייתכן שהסוכן כבר קיבל את ההודעה. שליחה חוזרת עלולה להפעיל את אותה פעולה פעמיים."
    click("שלח שוב בכל זאת")
    expect(document.body.textContent).toContain(warning)
    expect(promptTo).not.toHaveBeenCalled()
    click("ביטול")
    expect(document.body.textContent).not.toContain(warning)
    expect(promptTo).not.toHaveBeenCalled()
    click("שלח שוב בכל זאת")
    const stale = findButton(confirmLabel)
    active.current = { ...a, ownerKey: promptOwner(base, "fixture", "B"), generation: 2 }
    captureClickErrors(() => stale.click())
    await vm.refresh()
    flushSync()
    expect(document.body.textContent).not.toContain(warning)
    active.current = { ...a, generation: 3 }
    await vm.refresh()
    flushSync()
    expect(document.body.textContent).not.toContain(warning)
    expect(promptTo).not.toHaveBeenCalled()
    click("שלח שוב בכל זאת")
    const confirm = findButton(confirmLabel)
    captureClickErrors(() => {
      confirm.click()
      confirm.click()
    })
    flushSync()
    await vi.waitFor(() =>
      expect(promptTo).toHaveBeenCalledExactlyOnceWith(
        "A",
        [{ type: "text", text: "synthetic body" }],
        undefined,
      ),
    )
  })
})
