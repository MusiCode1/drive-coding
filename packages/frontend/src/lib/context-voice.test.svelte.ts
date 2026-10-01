// @vitest-environment jsdom
import { flushSync, mount, unmount } from "svelte"
import { afterEach, expect, it, vi } from "vitest"
import type { VoiceFacade } from "./context"
import Consumer from "./context-voice-consumer.harness.svelte"
import Provider from "./context-voice-provider.harness.svelte"

let target: HTMLDivElement | undefined
let app: object | undefined
afterEach(() => {
  if (app) unmount(app)
  target?.remove()
  app = undefined
  target = undefined
})

function mountTarget(): HTMLDivElement {
  target = document.createElement("div")
  document.body.appendChild(target)
  return target
}

it("one provider preserves all eight selector references and updates a mounted consumer", () => {
  const speaker = $state({ state: "idle" })
  const fields = {
    speaker,
    mic: {},
    live: {},
    voiceMode: {},
    cues: {},
    bubblePlayer: {},
    audioPlaylist: {},
    dictate: {},
  } as unknown as VoiceFacade
  const inspect = vi.fn<(values: VoiceFacade) => void>()
  const root = mountTarget()
  app = mount(Provider, { target: root, props: { voice: fields, inspect } })
  flushSync()
  expect(inspect).toHaveBeenCalledTimes(1)
  const selected = inspect.mock.calls[0]?.[0]
  expect(selected).toBeDefined()
  for (const key of [
    "speaker",
    "mic",
    "live",
    "voiceMode",
    "cues",
    "bubblePlayer",
    "audioPlaylist",
    "dictate",
  ] as const) {
    expect(selected?.[key]).toBe(fields[key])
  }
  expect(root.querySelector("[data-voice-state]")?.textContent).toBe("idle")
  speaker.state = "speaking"
  flushSync()
  expect(root.querySelector("[data-voice-state]")?.textContent).toBe("speaking")
  expect(inspect).toHaveBeenCalledTimes(1)
})

it("throws missing_context from a mounted consumer without a provider", () => {
  const root = mountTarget()
  expect(() => {
    app = mount(Consumer, { target: root, props: { inspect: vi.fn() } })
    flushSync()
  }).toThrow(/missing_context/)
})
