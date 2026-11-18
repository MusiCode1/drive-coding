import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  enumerateAudioInputs,
  onDeviceChange,
  openAudioStream,
} from "./audio-devices"

describe("openAudioStream", () => {
  const getUserMedia = vi.fn()
  const mockStream = {} as MediaStream

  beforeEach(() => {
    getUserMedia.mockReset()
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia, enumerateDevices: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("null opens with audio: true and fellBack false", async () => {
    getUserMedia.mockResolvedValue(mockStream)
    const r = await openAudioStream(null)
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
    expect(r.fellBack).toBe(false)
    expect(r.deviceId).toBe(null)
    expect(r.stream).toBe(mockStream)
  })

  it("id opens with exact deviceId constraint", async () => {
    getUserMedia.mockResolvedValue(mockStream)
    await openAudioStream("mic-abc")
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { deviceId: { exact: "mic-abc" } },
    })
  })

  it("OverconstrainedError on exact retries with audio:true", async () => {
    const err = new DOMException("over", "OverconstrainedError")
    getUserMedia.mockRejectedValueOnce(err).mockResolvedValueOnce(mockStream)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const r = await openAudioStream("gone")
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(getUserMedia).toHaveBeenLastCalledWith({ audio: true })
    expect(r.fellBack).toBe(true)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("exact deviceId failed"),
      expect.objectContaining({ errName: "OverconstrainedError" }),
    )
  })

  it("NotFoundError on exact uses same fallback path", async () => {
    const err = new DOMException("missing", "NotFoundError")
    getUserMedia.mockRejectedValueOnce(err).mockResolvedValueOnce(mockStream)
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const r = await openAudioStream("gone")
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(r.fellBack).toBe(true)
  })

  it("NotAllowedError on exact then on fallback throws fallback error", async () => {
    const exact = new DOMException("denied exact", "NotAllowedError")
    const fallback = new DOMException("denied fallback", "NotAllowedError")
    getUserMedia.mockRejectedValueOnce(exact).mockRejectedValueOnce(fallback)
    vi.spyOn(console, "warn").mockImplementation(() => {})
    await expect(openAudioStream("x")).rejects.toBe(fallback)
  })
})

describe("onDeviceChange", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns no-op when mediaDevices is missing", () => {
    vi.stubGlobal("navigator", {})
    const unsub = onDeviceChange(() => {})
    expect(() => unsub()).not.toThrow()
  })

  it("registers and removes devicechange listener", () => {
    const add = vi.fn()
    const remove = vi.fn()
    vi.stubGlobal("navigator", {
      mediaDevices: { addEventListener: add, removeEventListener: remove },
    })
    const cb = vi.fn()
    const unsub = onDeviceChange(cb)
    expect(add).toHaveBeenCalledWith("devicechange", cb)
    unsub()
    expect(remove).toHaveBeenCalledWith("devicechange", cb)
  })
})

describe("enumerateAudioInputs", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("filters to audioinput only", async () => {
    const devices = [
      { kind: "audioinput", deviceId: "a", label: "", groupId: "", toJSON: () => ({}) },
      { kind: "videoinput", deviceId: "v", label: "", groupId: "", toJSON: () => ({}) },
      { kind: "audiooutput", deviceId: "o", label: "", groupId: "", toJSON: () => ({}) },
      { kind: "audioinput", deviceId: "b", label: "", groupId: "", toJSON: () => ({}) },
    ] as MediaDeviceInfo[]
    vi.stubGlobal("navigator", {
      mediaDevices: {
        enumerateDevices: vi.fn().mockResolvedValue(devices),
      },
    })
    const inputs = await enumerateAudioInputs()
    expect(inputs).toHaveLength(2)
    expect(inputs.every((d) => d.kind === "audioinput")).toBe(true)
  })
})
