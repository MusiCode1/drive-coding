// @vitest-environment jsdom
/**
 * record-footer.test.ts — live input mode pane wiring (slice live-input-mode, Commit 1).
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

describe("RecordFooter — live input mode", () => {
  it("toggle has four tab buttons including live", () => {
    const root = mountHarness()
    const toggle = root.querySelector(".mic-card > div.flex.items-center.gap-1")
    expect(toggle?.querySelectorAll("button").length).toBe(4)
    expect(root.textContent).toContain("record.tab.live")
  })

  it("inputMode live => no MicLarge and no TypeArea in active pane", () => {
    const root = mountHarness({ inputMode: "live" })
    const pane = activePane(root)
    expect(pane.querySelector("[data-live-scroll]")).not.toBeNull()
    expect(pane.querySelector('button[aria-label="live.toggle.open"]')).not.toBeNull()
    expect(pane.querySelector('button[aria-label^="voiceMode.status."]')).toBeNull()
    expect(pane.querySelector("textarea")).toBeNull()
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

    const typingBtn = [...root.querySelectorAll("button")].find(
      (b) => b.textContent?.includes("record.tab.type"),
    )
    expect(typingBtn).toBeDefined()
    typingBtn!.click()
    flushSync()
    await Promise.resolve()

    expect(toggleCount).toBe(1)
  })
})
