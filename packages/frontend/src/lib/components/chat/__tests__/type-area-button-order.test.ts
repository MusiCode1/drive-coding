// @vitest-environment jsdom
/**
 * type-area-button-order.test.ts — Send before Stop in DOM + Enter keydown gate.
 *
 * ─── slice/type-area-align (Commit 2) ───
 */
import { mount, unmount } from "svelte"
import { afterEach, describe, expect, it, vi } from "vitest"
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
  sendPrompt?: (text: string) => void
} = {}): HTMLFormElement {
  target = document.createElement("div")
  document.body.appendChild(target)
  app = mount(TypeAreaHarness, {
    target,
    props: {
      enterToSend: props.enterToSend ?? false,
      sendPrompt: props.sendPrompt ?? (() => {}),
    },
  })
  const form = target.querySelector("form")
  if (!(form instanceof HTMLFormElement)) {
    throw new Error("TypeArea form not found")
  }
  return form
}

describe("TypeArea — button order (type-area-align)", () => {
  it("submit button appears before stop-run in form DOM", () => {
    const form = mountHarness()
    const buttons = [...form.querySelectorAll("button")]
    const submitIdx = buttons.findIndex((b) => b.type === "submit")
    const stopIdx = buttons.findIndex((b) => b.classList.contains("type-area-stop-run"))
    expect(submitIdx).toBeGreaterThanOrEqual(0)
    expect(stopIdx).toBeGreaterThanOrEqual(0)
    expect(submitIdx).toBeLessThan(stopIdx)
  })
})

describe("TypeArea — Enter to send (type-area-align)", () => {
  it("keydown Enter on textarea calls sendPrompt when enterToSend is true", async () => {
    const sendPrompt = vi.fn()
    mountHarness({ enterToSend: true, sendPrompt })

    const textarea = target?.querySelector("textarea")
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new Error("textarea not found")
    }
    textarea.value = "hello"
    textarea.dispatchEvent(new Event("input", { bubbles: true }))

    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    )

    expect(sendPrompt).toHaveBeenCalledOnce()
    expect(sendPrompt).toHaveBeenCalledWith("hello", { attachments: [] })
  })
})
