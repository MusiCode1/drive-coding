// @vitest-environment jsdom
/**
 * elicitation-dialog-select.test.ts — visible radio options for kind:"select".
 *
 * ─── slice/elicitation-options-visible (Commit 0) ───
 */
import { flushSync, mount, unmount } from "svelte"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ElicitationParams } from "$lib/types/elicitation"
import ElicitationDialogHarness from "./elicitation-dialog-harness.svelte"

let target: HTMLDivElement | null = null
let app: object | null = null

afterEach(() => {
  if (app !== null) unmount(app)
  target?.remove()
  target = null
  app = null
})

const selectParams = {
  sessionId: "s1",
  mode: "form",
  message: "Pick a color",
  requestedSchema: {
    type: "object",
    properties: {
      color: { type: "string", enum: ["red", "blue"] },
    },
    required: ["color"],
  },
} as ElicitationParams

function mountHarness(props: {
  params?: ElicitationParams
  onResolve?: (content: Record<string, string | number | boolean>) => void
} = {}): void {
  target = document.createElement("div")
  document.body.appendChild(target)
  app = mount(ElicitationDialogHarness, {
    target,
    props: {
      params: props.params ?? selectParams,
      onResolve: props.onResolve ?? (() => {}),
    },
  })
}

describe("ElicitationDialog — select field (elicitation-options-visible)", () => {
  it("renders two visible radio inputs for enum options", () => {
    mountHarness()
    const radios = target?.querySelectorAll('input[type="radio"]')
    expect(radios?.length).toBe(2)
    const values = [...(radios ?? [])].map((r) => (r as HTMLInputElement).value)
    expect(values).toEqual(["red", "blue"])
  })

  it("accept resolves with selected radio value", () => {
    const onResolve = vi.fn()
    mountHarness({ onResolve })

    const redRadio = target?.querySelector('input[type="radio"][value="red"]')
    if (!(redRadio instanceof HTMLInputElement)) {
      throw new Error("red radio not found")
    }
    redRadio.click()
    flushSync()

    const acceptBtn = target?.querySelector("button.btn.accept")
    if (!(acceptBtn instanceof HTMLButtonElement)) {
      throw new Error("accept button not found")
    }
    expect(acceptBtn.disabled).toBe(false)
    acceptBtn.click()

    expect(onResolve).toHaveBeenCalledOnce()
    expect(onResolve).toHaveBeenCalledWith({ color: "red" })
  })
})
