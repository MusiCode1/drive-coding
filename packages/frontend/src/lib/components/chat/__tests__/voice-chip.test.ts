// @vitest-environment jsdom
/**
 * voice-chip.test.ts — a row of VoiceChip's popup (slice codex-voice-poc): the row picks the
 * voice; ▶/■ plays its sample without picking, and is absent for a voice without one.
 *
 * The popup itself (bits-ui Dialog: open on tap, close on pick/Escape → stop the sample) is not
 * mounted here — bits-ui's internal state does not react under this jsdom setup (open=true never
 * renders content; no FE test renders an open bits-ui dialog). It was checked in a real browser.
 */
import { flushSync, mount, unmount } from "svelte"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { VoiceChipOption } from "../VoiceChip.svelte"
import VoiceChipHarness from "./voice-chip-harness.svelte"

let target: HTMLDivElement | null = null
let app: object | null = null

afterEach(() => {
  if (app !== null) unmount(app)
  target?.remove()
  target = null
  app = null
})

const cove: VoiceChipOption = {
  value: "cove",
  label: "cove",
  detail: "American English",
  sample: true,
}

function mountRow(props: { selected?: boolean; playing?: boolean; withPreview?: boolean } = {}) {
  const onpick = vi.fn()
  const onpreview = vi.fn()
  target = document.createElement("div")
  document.body.appendChild(target)
  app = mount(VoiceChipHarness, {
    target,
    props: {
      option: cove,
      selected: props.selected ?? false,
      playing: props.playing ?? false,
      onpick,
      onpreview: props.withPreview === false ? undefined : onpreview,
    },
  })
  const buttons = [...(target.querySelectorAll("button") ?? [])]
  return { onpick, onpreview, row: buttons[0], preview: buttons[1], count: buttons.length }
}

describe("VoiceChipRow (codex-voice-poc)", () => {
  it("shows the voice with its detail; tapping the row picks it", () => {
    const { row, onpick, onpreview } = mountRow()
    expect(row?.textContent).toContain("cove")
    expect(row?.textContent).toContain("American English")
    row?.click()
    flushSync()
    expect(onpick).toHaveBeenCalledTimes(1)
    expect(onpreview).not.toHaveBeenCalled()
  })

  it("▶ plays the sample without picking", () => {
    const { preview, onpick, onpreview } = mountRow()
    expect(preview?.getAttribute("aria-label")).toBe("agentVoice.preview — cove")
    expect(preview?.getAttribute("aria-pressed")).toBe("false")
    preview?.click()
    flushSync()
    expect(onpreview).toHaveBeenCalledTimes(1)
    expect(onpick).not.toHaveBeenCalled()
  })

  it("while playing, the button turns into stop", () => {
    const { preview } = mountRow({ playing: true })
    expect(preview?.getAttribute("aria-label")).toBe("agentVoice.stopPreview — cove")
    expect(preview?.getAttribute("aria-pressed")).toBe("true")
  })

  it("no sample (or an engine without samples) → no ▶ at all", () => {
    expect(mountRow({ withPreview: false }).count).toBe(1)
  })

  it("the chosen voice is marked", () => {
    expect(mountRow({ selected: true }).row?.getAttribute("aria-current")).toBe("true")
  })
})
