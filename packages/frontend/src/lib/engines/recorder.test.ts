import { beforeEach, describe, expect, it, vi } from "vitest"

const openAudioStream = vi.fn()

vi.mock("../adapters/audio-devices", () => ({
  openAudioStream: (...args: unknown[]) => openAudioStream(...args),
}))

vi.stubGlobal("MediaRecorder", class MockMediaRecorder {
  mimeType = "audio/webm"
  state = "inactive"
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  constructor(
    _stream: MediaStream,
    _opts?: unknown,
  ) {}
  start() {
    this.state = "recording"
  }
  stop() {
    this.state = "inactive"
    this.onstop?.()
  }
})

import { Recorder } from "./recorder"

describe("Recorder input device (mic-device-selection)", () => {
  beforeEach(() => {
    openAudioStream.mockReset()
    openAudioStream.mockResolvedValue({
      stream: { getTracks: () => [] } as unknown as MediaStream,
      deviceId: "x",
      fellBack: false,
    })
    ;(MediaRecorder as unknown as { isTypeSupported: (t: string) => boolean }).isTypeSupported =
      () => true
  })

  it("start(deviceId) delegates to openAudioStream", async () => {
    const r = new Recorder()
    await r.start("x")
    expect(openAudioStream).toHaveBeenCalledWith("x")
  })
})
