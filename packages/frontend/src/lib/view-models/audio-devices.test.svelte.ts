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

function mountHarness(opts?: { prefId?: string; prefLabel?: string }): HarnessExports {
  target = document.createElement("div")
  document.body.appendChild(target)
  app = mount(Harness, { target, props: opts ?? {} }) as HarnessExports
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

  test("cold load: saved preference yields effectiveInputId after init refresh", async () => {
    enumerateAudioInputs.mockResolvedValue([device("phone", "Phone Mic")])
    const { vm } = mountHarness({ prefId: "phone", prefLabel: "Phone Mic" })
    await vi.waitFor(() => expect(vm.effectiveInputId).toBe("phone"))
    expect(enumerateAudioInputs).toHaveBeenCalled()
    expect(openAudioStream).not.toHaveBeenCalled()
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
    enumerateAudioInputs.mockResolvedValue([device("a")])
    mountHarness()
    await vi.waitFor(() => expect(enumerateAudioInputs).toHaveBeenCalledTimes(1))
    const trigger = onDeviceChange.mock.calls[0]?.[0] as (() => void) | undefined
    expect(typeof trigger).toBe("function")
    enumerateAudioInputs.mockResolvedValue([device("a"), device("b")])
    trigger?.()
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
    await vi.waitFor(() => expect(vm.inputs).toHaveLength(1))
    await vm.primeLabels()
    expect(openAudioStream).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalled()
    expect(enumerateAudioInputs).toHaveBeenCalledTimes(2)
    expect(vm.inputs[0]?.label).toBe("Named mic")
  })
})
