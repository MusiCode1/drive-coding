// @vitest-environment jsdom
/**
 * type-area-stop-run.test.ts — component gate for stop-run button styling hook.
 *
 * ─── slice/ui-var-fixes (Commit 2) ───
 *
 * The bug was conditional class tied to isRunActive (inverse of disabled),
 * so the disabled-state CSS selector could never match. The fix is a fixed
 * base class styled via :disabled / :not(:disabled).
 */
import { mount, unmount } from "svelte"
import { afterEach, describe, expect, it } from "vitest"
import TypeAreaHarness from "./type-area-harness.svelte"

let target: HTMLDivElement | null = null
let app: object | null = null

afterEach(() => {
  if (app !== null) unmount(app)
  target?.remove()
  target = null
  app = null
})

function mountHarness(isRunActive: boolean): HTMLButtonElement {
  target = document.createElement("div")
  document.body.appendChild(target)
  app = mount(TypeAreaHarness, {
    target,
    props: { isRunActive },
  })
  const btn = target.querySelector("button.type-area-stop-run")
  if (!(btn instanceof HTMLButtonElement)) {
    throw new Error("stop-run button not found")
  }
  return btn
}

describe("TypeArea — stop-run button (ui-var-fixes)", () => {
  it("isRunActive=false: carries base class and is disabled", () => {
    const btn = mountHarness(false)
    expect(btn.classList.contains("type-area-stop-run")).toBe(true)
    expect(btn.disabled).toBe(true)
  })

  it("isRunActive=true: carries base class and is enabled", () => {
    const btn = mountHarness(true)
    expect(btn.classList.contains("type-area-stop-run")).toBe(true)
    expect(btn.disabled).toBe(false)
  })
})
