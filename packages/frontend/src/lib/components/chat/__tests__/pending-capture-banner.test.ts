// @vitest-environment jsdom
/**
 * pending-capture-banner.test.ts — permission error visible without canRetry.
 */
import { flushSync, mount, unmount } from "svelte"
import { afterEach, describe, expect, it } from "vitest"
import type { MessageKey } from "@drive-coding/core/i18n"
import BannerHarness from "./pending-capture-banner-harness.svelte"

let target: HTMLDivElement | null = null
let app: object | null = null

afterEach(() => {
  if (app !== null) unmount(app)
  target?.remove()
  target = null
  app = null
})

function mountBanner(props: {
  error?: MessageKey | null
  canRetry?: boolean
  restored?: boolean
}): HTMLDivElement {
  target = document.createElement("div")
  document.body.appendChild(target)
  app = mount(BannerHarness, { target, props })
  flushSync()
  return target
}

describe("PendingCaptureBanner", () => {
  it("shows permission error when canRetry is false", () => {
    const root = mountBanner({
      error: "mic.error.permission",
      canRetry: false,
    })
    const alert = root.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert?.textContent).toContain("mic.error.permission")
    expect(alert?.textContent).toContain("pendingCapture.dismiss")
    expect(alert?.textContent?.includes("pendingCapture.retry")).toBe(false)
  })

  it("hides when no error and not restored", () => {
    const root = mountBanner({ error: null, canRetry: false })
    expect(root.querySelector('[role="alert"]')).toBeNull()
  })

  it("shows retry when canRetry", () => {
    const root = mountBanner({
      error: "mic.error.transcribe",
      canRetry: true,
    })
    const alert = root.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain("pendingCapture.retry")
    expect(alert?.textContent).toContain("pendingCapture.dismiss")
  })
})
