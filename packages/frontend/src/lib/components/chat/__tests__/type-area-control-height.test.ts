// @vitest-environment jsdom
/**
 * type-area-control-height.test.ts — uniform --control-h token on all TypeArea controls.
 *
 * ─── slice/type-area-align (Commit 1) ───
 */
import { mount, unmount } from "svelte"
import { afterEach, describe, expect, it } from "vitest"
import TypeAreaHarness from "./type-area-harness.svelte"

const CONTROL_MIN_HEIGHT = "var(--control-h)"

let target: HTMLDivElement | null = null
let app: object | null = null

afterEach(() => {
  if (app !== null) unmount(app)
  target?.remove()
  target = null
  app = null
})

function mountHarness(supportsImageInput: boolean): HTMLElement {
  target = document.createElement("div")
  document.body.appendChild(target)
  app = mount(TypeAreaHarness, {
    target,
    props: { supportsImageInput },
  })
  const form = target.querySelector("form")
  if (!(form instanceof HTMLFormElement)) {
    throw new Error("TypeArea form not found")
  }
  return form
}

function controlMinHeights(form: HTMLElement, supportsImageInput: boolean): string[] {
  const textarea = form.querySelector("textarea.type-area-control")
  const stop = form.querySelector("button.type-area-stop-run")
  const send = form.querySelector('button[type="submit"]')
  const image = form.querySelector('button[aria-label="attach.addImage"]')
  const dictate = form.querySelector('button[aria-label="dictate.start"]')

  const controls: Element[] = []
  if (supportsImageInput && image) controls.push(image)
  if (dictate) controls.push(dictate)
  if (textarea) controls.push(textarea)
  if (send) controls.push(send)
  if (stop) controls.push(stop)

  return controls.map((el) => (el instanceof HTMLElement ? el.style.minHeight : ""))
}

describe("TypeArea — control height token (type-area-align)", () => {
  it.each([false, true])(
    "supportsImageInput=%s: all controls share min-height:var(--control-h)",
    (supportsImageInput) => {
      const form = mountHarness(supportsImageInput)
      expect(form.classList.contains("items-end")).toBe(true)
      expect(form.style.getPropertyValue("--control-h")).toBe("2.5rem")

      const heights = controlMinHeights(form, supportsImageInput)
      const expectedCount = supportsImageInput ? 5 : 4
      expect(heights).toHaveLength(expectedCount)
      expect(new Set(heights)).toEqual(new Set([CONTROL_MIN_HEIGHT]))
    },
  )

  it.each([false, true])(
    "supportsImageInput=%s: icon buttons carry aspect-ratio class hook",
    (supportsImageInput) => {
      mountHarness(supportsImageInput)
      const iconControls = target?.querySelectorAll("button.type-area-icon-control")
      expect(iconControls?.length).toBe(supportsImageInput ? 3 : 2)
    },
  )
})
