// @vitest-environment jsdom
import { mount, tick, unmount } from "svelte"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import Harness from "./audio-devices.harness.svelte"

const enumerateAudioInputs = vi.fn()
const onDeviceChange = vi.fn()
const openAudioStream = vi.fn()

vi.mock("../adapters/audio-devices", () => ({
  enumerateAudioInputs: (...args: unknown[]) => enumerateAudioInputs(...args),
  onDeviceChange: (...args: unknown[]) => onDeviceChange(...args),
  openAudioStream: (...args: unknown[]) => openAudioStream(...args),
}))

function device(id: string, label = ""): MediaDeviceInfo {
  return {
    deviceId: id,
    kind: "audioinput",
    label,
    groupId: "g",
    toJSON: () => ({}),
  } as MediaDeviceInfo
}

type HarnessExports = { vm: import("./audio-devices.svelte").AudioDevicesVM; settings: import("./settings.svelte").Settings }

let target: HTMLDivElement | null = null
let app: HarnessExports | null = null

function mountHarness(): HarnessExports {
  target = document.createElement("div")
  document.body.appendChild(target)
  app = mount(Harness, { target }) as HarnessExports
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  enumerateAudioInputs.mockResolvedValue([])
  onDeviceChange.mockReturnValue(() => {})
  openAudioStream.mockResolvedValue({
    stream: { getTracks: () => [{ stop: vi.fn() }] },
    deviceId: null,
    fellBack: false,
  })
})

afterEach(() => {
  if (app !== null) unmount(app)
  target?.remove()
  app = null
  target = null
  vi.unstubAllGlobals()
})

describe("AudioDevicesVM", () => {
  test("refresh populates inputs without openAudioStream", async () => {
    enumerateAudioInputs.mockResolvedValue([device("a", "Mic A")])
    const { vm } = mountHarness()
    await vm.refresh()
    expect(vm.inputs).toHaveLength(1)
    expect(openAudioStream).not.toHaveBeenCalled()
  })

  test("empty labels set needsPermissionForLabels", async () => {
    enumerateAudioInputs.mockResolvedValue([device("a", "")])
    const { vm } = mountHarness()
    await vm.refresh()
    expect(vm.needsPermissionForLabels).toBe(true)
  })

  test("preference listed yields effectiveInputId", async () => {
    enumerateAudioInputs.mockResolvedValue([device("pick", "P")])
    const { vm, settings } = mountHarness()
    settings.setInputDevice("pick", "P")
    await vm.refresh()
    expect(vm.effectiveInputId).toBe("pick")
  })

  test("missing preference yields null effective but keeps settings id", async () => {
    enumerateAudioInputs.mockResolvedValue([device("other", "O")])
    const { vm, settings } = mountHarness()
    settings.setInputDevice("gone", "Gone")
    await vm.refresh()
    expect(vm.effectiveInputId).toBe(null)
    expect(settings.inputDeviceId).toBe("gone")
  })

  test("preference returns when device reappears", async () => {
    const { vm, settings } = mountHarness()
    settings.setInputDevice("back", "Back")
    enumerateAudioInputs.mockResolvedValue([device("other")])
    await vm.refresh()
    expect(vm.effectiveInputId).toBe(null)
    enumerateAudioInputs.mockResolvedValue([device("back", "Back")])
    await vm.refresh()
    expect(vm.effectiveInputId).toBe("back")
  })

  test("devicechange callback triggers refresh", async () => {
    let cb: (() => void) | null = null
    onDeviceChange.mockImplementation((fn: () => void) => {
      cb = fn
      return () => {}
    })
    enumerateAudioInputs.mockResolvedValue([device("a")])
    const { vm } = mountHarness()
    await vm.refresh()
    expect(enumerateAudioInputs).toHaveBeenCalledTimes(1)
    enumerateAudioInputs.mockResolvedValue([device("a"), device("b")])
    if (cb) cb()
    await tick()
    await vi.waitFor(() => expect(enumerateAudioInputs.mock.calls.length).toBeGreaterThan(1))
  })

  test("effect cleanup removes devicechange listener", async () => {
    const remove = vi.fn()
    onDeviceChange.mockReturnValue(remove)
    mountHarness()
    await tick()
    expect(onDeviceChange).toHaveBeenCalled()
    if (app !== null) unmount(app)
    expect(remove).toHaveBeenCalled()
    app = null
  })

  test("primeLabels opens stream, stops tracks, refreshes labels", async () => {
    const stop = vi.fn()
    openAudioStream.mockResolvedValue({
      stream: { getTracks: () => [{ stop }] },
      deviceId: null,
      fellBack: false,
    })
    enumerateAudioInputs
      .mockResolvedValueOnce([device("a", "")])
      .mockResolvedValueOnce([device("a", "Named mic")])
    const { vm } = mountHarness()
    await vm.refresh()
    await vm.primeLabels()
    expect(openAudioStream).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalled()
    expect(enumerateAudioInputs).toHaveBeenCalledTimes(2)
    expect(vm.inputs[0]?.label).toBe("Named mic")
  })
})
