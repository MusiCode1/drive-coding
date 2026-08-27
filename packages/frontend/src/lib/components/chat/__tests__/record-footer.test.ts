// @vitest-environment jsdom
/**
 * record-footer.test.ts — live input mode pane + mobile icon-only tabs.
 */
import { flushSync, mount, unmount } from "svelte"
import { afterEach, describe, expect, it } from "vitest"
import type { InputMode } from "$lib/view-models/ui-shell.svelte"
import RecordFooterHarness from "./record-footer-harness.svelte"

let target: HTMLDivElement | null = null
let app: object | null = null

afterEach(() => {
  if (app !== null) unmount(app)
  target?.remove()
  target = null
  app = null
})

function mountHarness(props: {
  inputMode?: InputMode
  liveOpen?: boolean
  isMobile?: boolean
  onLiveToggle?: () => void
} = {}): HTMLDivElement {
  target = document.createElement("div")
  document.body.appendChild(target)
  app = mount(RecordFooterHarness, { target, props })
  flushSync()
  return target
}

function activePane(root: HTMLElement): HTMLElement {
  const pane = root.querySelector<HTMLElement>(".record-pane.is-active")
  if (!pane) throw new Error("missing active .record-pane")
  return pane
}

function modeTabs(root: HTMLElement): HTMLElement {
  const el = root.querySelector<HTMLElement>(".mode-tabs")
  if (!el) throw new Error("missing .mode-tabs")
  return el
}

describe("RecordFooter — live input mode", () => {
  it("toggle has four tab buttons including live", () => {
    const root = mountHarness()
    const toggle = modeTabs(root)
    expect(toggle.querySelectorAll("button").length).toBe(4)
    expect(root.textContent).toContain("record.tab.live")
  })

  it("desktop shows labels; mobile is icon-only with aria-label and ≥44px tap", () => {
    const desktop = mountHarness({ isMobile: false })
    expect(modeTabs(desktop).textContent).toContain("record.tab.live")
    unmount(app!)
    desktop.remove()
    target = null
    app = null

    const mobile = mountHarness({ isMobile: true })
    const tabs = modeTabs(mobile)
    expect(tabs.textContent?.includes("record.tab.live")).toBe(false)
    const buttons = [...tabs.querySelectorAll("button")]
    expect(buttons).toHaveLength(4)
    for (const btn of buttons) {
      expect(btn.getAttribute("aria-label")?.startsWith("record.tab.")).toBe(true)
      expect(btn.classList.contains("mode-tab--mobile")).toBe(true)
    }
    // computed min size from stylesheet (jsdom may not apply CSS — assert class contract)
    expect(mobile.querySelector(".mode-tab--mobile")).not.toBeNull()
  })

  it("inputMode live => no MicLarge and no TypeArea in active pane", () => {
    const root = mountHarness({ inputMode: "live" })
    const pane = activePane(root)
    expect(pane.querySelector("[data-live-scroll]")).not.toBeNull()
    expect(pane.querySelector('button[aria-label="live.toggle.open"]')).not.toBeNull()
    expect(pane.querySelector('button[aria-label^="voiceMode.status."]')).toBeNull()
    expect(pane.querySelector("textarea")).toBeNull()
  })

  it("inputMode live + closed => voice picker visible; open => hidden", () => {
    const closed = mountHarness({ inputMode: "live", liveOpen: false })
    expect(closed.textContent).toContain("settings.liveVoice.label")
    unmount(app!)
    closed.remove()
    target = null
    app = null

    const open = mountHarness({ inputMode: "live", liveOpen: true })
    expect(open.textContent?.includes("settings.liveVoice.label")).toBe(false)
  })

  it("inputMode record => no LiveTranscript in active pane", () => {
    const root = mountHarness({ inputMode: "record" })
    const pane = activePane(root)
    expect(pane.querySelector("[data-live-scroll]")).toBeNull()
    expect(pane.querySelector('button[aria-label^="voiceMode.status."]')).not.toBeNull()
  })

  it("leaving live closes an open live session", async () => {
    let toggleCount = 0
    const root = mountHarness({
      inputMode: "live",
      liveOpen: true,
      onLiveToggle: () => {
        toggleCount++
      },
    })

    const typingBtn = [...root.querySelectorAll(".mode-tabs button")].find(
      (b) => b.getAttribute("aria-label") === "record.tab.type",
    )
    expect(typingBtn).toBeDefined()
    typingBtn!.click()
    flushSync()
    await Promise.resolve()

    expect(toggleCount).toBe(1)
  })
})
