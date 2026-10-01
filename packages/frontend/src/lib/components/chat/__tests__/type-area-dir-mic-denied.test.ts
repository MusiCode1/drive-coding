// @vitest-environment jsdom
/**
 * type-area-dir-mic-denied.test.ts — the empty composer follows the locale direction (so
 * an English locale gets an LTR bar), and a denied mic shows as an icon, not text.
 *
 * ─── slice ltr-in-english-mic-denied ───
 */
import { mount, tick, unmount } from "svelte"
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

function mountHarness(
  props: { dir?: "rtl" | "ltr"; micPermissionDenied?: boolean } = {},
): HTMLTextAreaElement {
  target = document.createElement("div")
  document.body.appendChild(target)
  app = mount(TypeAreaHarness, { target, props })
  const textarea = target.querySelector("textarea")
  if (!(textarea instanceof HTMLTextAreaElement)) {
    throw new Error("TypeArea textarea not found")
  }
  return textarea
}

describe("TypeArea — composer direction", () => {
  it("empty composer is ltr under an ltr locale (was hardcoded rtl)", () => {
    expect(mountHarness({ dir: "ltr" }).getAttribute("dir")).toBe("ltr")
  })

  it("empty composer is rtl under an rtl locale", () => {
    expect(mountHarness({ dir: "rtl" }).getAttribute("dir")).toBe("rtl")
  })

  it("typed text switches to dir=auto so content decides", async () => {
    const textarea = mountHarness({ dir: "ltr" })
    textarea.value = "שלום"
    textarea.dispatchEvent(new Event("input", { bubbles: true }))
    await tick()
    expect(textarea.getAttribute("dir")).toBe("auto")
  })
})

describe("TypeArea — denied microphone", () => {
  it("renders the mic-off icon and no status text when permission is denied", () => {
    mountHarness({ micPermissionDenied: true })
    expect(target?.querySelector(".lucide-mic-off")).not.toBeNull()
    expect(target?.querySelector(".lucide-mic")).toBeNull()
    expect(target?.querySelector("[role='status']")).toBeNull()
  })

  it("renders the plain mic icon when permission is not denied", () => {
    mountHarness()
    expect(target?.querySelector(".lucide-mic-off")).toBeNull()
    expect(target?.querySelector(".lucide-mic")).not.toBeNull()
  })
})
