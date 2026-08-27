// @vitest-environment jsdom
/**
 * live-transcript.test.ts — DoD 3+4+6 (slice live-transcript-box §6).
 *
 * jsdom has no Tailwind stylesheet — ceiling must be inline style, not class.
 */
import { flushSync, mount, unmount } from "svelte"
import { afterEach, describe, expect, it } from "vitest"
import type { LiveTranscriptEntry } from "$lib/engines/live-session"
import LiveTranscriptHarness from "./live-transcript-harness.svelte"

let target: HTMLDivElement | null = null
let app: object | null = null

afterEach(() => {
  if (app !== null) unmount(app)
  target?.remove()
  target = null
  app = null
})

function makeEntry(id: number, text: string): LiveTranscriptEntry {
  return { id, role: "assistant", text, final: true }
}

function mountHarness(transcript: LiveTranscriptEntry[]): HTMLDivElement {
  target = document.createElement("div")
  document.body.appendChild(target)
  app = mount(LiveTranscriptHarness, { target, props: { transcript } })
  flushSync()
  return target
}

function scrollBox(root: HTMLElement): HTMLElement {
  const el = root.querySelector<HTMLElement>("[data-live-scroll]")
  if (!el) throw new Error("missing [data-live-scroll]")
  return el
}

describe("LiveTranscript — DoD 3: תקרת גובה inline", () => {
  it("computed max-height != none and overflow-y == auto", () => {
    const root = mountHarness([makeEntry(0, "hello")])
    const box = scrollBox(root)
    const style = getComputedStyle(box)
    expect(style.maxHeight).not.toBe("none")
    expect(style.overflowY).toBe("auto")
  })
})

describe("LiveTranscript — DoD 4: data-live-entry per row", () => {
  it("25 entries → 25 [data-live-entry] nodes", () => {
    const entries = Array.from({ length: 25 }, (_, i) => makeEntry(i, `line ${i}`))
    const root = mountHarness(entries)
    expect(root.querySelectorAll("[data-live-entry]").length).toBe(25)
  })
})
