// @vitest-environment jsdom
/**
 * type-area-dictate-send.test.ts — Send during listening + busy spinner gates.
 *
 * ─── slice dictate-to-input-polish (C1) ───
 */
import { mount, unmount } from "svelte"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AgentSession } from "$lib/view-models/agent-session.svelte"
import type { FinishListeningResult } from "$lib/view-models/dictate.svelte"
import TypeAreaHarness from "./type-area-harness.svelte"

let target: HTMLDivElement | null = null
let app: object | null = null

afterEach(() => {
  if (app !== null) unmount(app)
  target?.remove()
  target = null
  app = null
})

function mountHarness(props: {
  enterToSend?: boolean
  dictateState?: "idle" | "listening" | "busy"
  finishListening?: () => Promise<FinishListeningResult>
  sendPrompt?: (text: string, opts?: { attachments?: unknown[] }) => void
  session?: { status: AgentSession["status"] }
} = {}): HTMLFormElement {
  target = document.createElement("div")
  document.body.appendChild(target)
  app = mount(TypeAreaHarness, {
    target,
    props: {
      enterToSend: props.enterToSend ?? false,
      dictateState: props.dictateState,
      finishListening: props.finishListening,
      sendPrompt: props.sendPrompt ?? (() => {}),
      session: props.session,
    },
  })
  const form = target.querySelector("form")
  if (!(form instanceof HTMLFormElement)) {
    throw new Error("TypeArea form not found")
  }
  return form
}

function getSubmitButton(form: HTMLFormElement): HTMLButtonElement {
  const btn = form.querySelector('button[type="submit"]')
  if (!(btn instanceof HTMLButtonElement)) {
    throw new Error("submit button not found")
  }
  return btn
}

function getTextarea(): HTMLTextAreaElement {
  const textarea = target?.querySelector("textarea")
  if (!(textarea instanceof HTMLTextAreaElement)) {
    throw new Error("textarea not found")
  }
  return textarea
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe("TypeArea — send during listening (dictate-to-input-polish)", () => {
  it("listening + empty draft + voice stub sends directly without showing voice in textarea", async () => {
    const sendPrompt = vi.fn()
    const finishListening = vi.fn(async () => ({ ok: true, text: "voice" } as const))
    const form = mountHarness({ dictateState: "listening", finishListening, sendPrompt })

    const textarea = getTextarea()
    expect(textarea.value).toBe("")

    getSubmitButton(form).click()
    expect(textarea.value).not.toContain("voice")

    await flushMicrotasks()

    expect(finishListening).toHaveBeenCalledOnce()
    expect(sendPrompt).toHaveBeenCalledOnce()
    expect(sendPrompt).toHaveBeenCalledWith("voice", { attachments: [] })
    expect(textarea.value).toBe("")
  })

  it("listening + typed text + voice stub sends combined body", async () => {
    const sendPrompt = vi.fn()
    const finishListening = vi.fn(async () => ({ ok: true, text: "voice" } as const))
    mountHarness({ dictateState: "listening", finishListening, sendPrompt })

    const textarea = getTextarea()
    textarea.value = "typed"
    textarea.dispatchEvent(new Event("input", { bubbles: true }))

    getSubmitButton(document.querySelector("form") as HTMLFormElement).click()
    await flushMicrotasks()

    expect(sendPrompt).toHaveBeenCalledWith("typed voice", { attachments: [] })
  })

  it("typing during finishListening await is included in sent body", async () => {
    const sendPrompt = vi.fn()
    let resolveFinish!: (value: FinishListeningResult) => void
    const finishListening = vi.fn(
      () =>
        new Promise<FinishListeningResult>((resolve) => {
          resolveFinish = resolve
        }),
    )
    mountHarness({ dictateState: "listening", finishListening, sendPrompt })

    getSubmitButton(document.querySelector("form") as HTMLFormElement).click()

    const textarea = getTextarea()
    textarea.value = "during"
    textarea.dispatchEvent(new Event("input", { bubbles: true }))

    resolveFinish({ ok: true, text: "voice" })
    await flushMicrotasks()

    expect(sendPrompt).toHaveBeenCalledWith("during voice", { attachments: [] })
  })

  it("disconnect after finishListening await skips sendPrompt and clear", async () => {
    const sendPrompt = vi.fn()
    const session: { status: AgentSession["status"] } = { status: "connected" }
    const finishListening = vi.fn(async () => {
      session.status = "disconnected"
      return { ok: true, text: "voice" } as const
    })
    mountHarness({ dictateState: "listening", finishListening, sendPrompt, session })

    const textarea = getTextarea()
    textarea.value = "keep me"
    textarea.dispatchEvent(new Event("input", { bubbles: true }))

    getSubmitButton(document.querySelector("form") as HTMLFormElement).click()
    await flushMicrotasks()

    expect(sendPrompt).not.toHaveBeenCalled()
    expect(textarea.value).toBe("keep me")
  })

  it("submit disabled when busy even with text", () => {
    const form = mountHarness({ dictateState: "busy" })
    const textarea = getTextarea()
    textarea.value = "hello"
    textarea.dispatchEvent(new Event("input", { bubbles: true }))

    expect(getSubmitButton(form).disabled).toBe(true)
  })

  it("submit disabled when idle and empty", () => {
    const form = mountHarness({ dictateState: "idle" })
    expect(getSubmitButton(form).disabled).toBe(true)
  })

  it("Enter with enterToSend during listening triggers send", async () => {
    const sendPrompt = vi.fn()
    const finishListening = vi.fn(async () => ({ ok: true, text: "voice" } as const))
    mountHarness({ dictateState: "listening", enterToSend: true, finishListening, sendPrompt })

    const textarea = getTextarea()
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    )
    await flushMicrotasks()

    expect(finishListening).toHaveBeenCalledOnce()
    expect(sendPrompt).toHaveBeenCalledWith("voice", { attachments: [] })
  })
})

describe("TypeArea — idle typed send remains synchronous until first await", () => {
  it("idle + text sends on Enter without finishListening", () => {
    const sendPrompt = vi.fn()
    const finishListening = vi.fn()
    mountHarness({ dictateState: "idle", enterToSend: true, finishListening, sendPrompt })

    const textarea = getTextarea()
    textarea.value = "hello"
    textarea.dispatchEvent(new Event("input", { bubbles: true }))

    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    )

    expect(finishListening).not.toHaveBeenCalled()
    expect(sendPrompt).toHaveBeenCalledOnce()
    expect(sendPrompt).toHaveBeenCalledWith("hello", { attachments: [] })
  })
})
