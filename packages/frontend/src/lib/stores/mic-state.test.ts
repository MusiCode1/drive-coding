import { describe, expect, it } from "vitest"
import { deriveMicState, type MicState } from "./mic-state.svelte"

describe("deriveMicState", () => {
  it("idle when nothing is happening", () => {
    expect(
      deriveMicState({
        isRecording: false,
        isThinking: false,
        isAudioPlaying: false,
        isCancelling: false,
      }),
    ).toBe<MicState>("idle")
  })

  it("recording when isRecording=true (trumps all)", () => {
    expect(
      deriveMicState({
        isRecording: true,
        isThinking: false,
        isAudioPlaying: false,
        isCancelling: false,
      }),
    ).toBe<MicState>("recording")
  })

  it("recording even when isThinking also true", () => {
    expect(
      deriveMicState({
        isRecording: true,
        isThinking: true,
        isAudioPlaying: false,
        isCancelling: false,
      }),
    ).toBe<MicState>("recording")
  })

  it("processing when isThinking=true and not recording", () => {
    expect(
      deriveMicState({
        isRecording: false,
        isThinking: true,
        isAudioPlaying: false,
        isCancelling: false,
      }),
    ).toBe<MicState>("processing")
  })

  it("speaking when isAudioPlaying=true and not recording/thinking", () => {
    expect(
      deriveMicState({
        isRecording: false,
        isThinking: false,
        isAudioPlaying: true,
        isCancelling: false,
      }),
    ).toBe<MicState>("speaking")
  })

  it("cancelling when isCancelling=true (trumps speaking/thinking)", () => {
    expect(
      deriveMicState({
        isRecording: false,
        isThinking: true,
        isAudioPlaying: true,
        isCancelling: true,
      }),
    ).toBe<MicState>("cancelling")
  })

  it("cancelling beats recording — cancel takes priority over recording", () => {
    expect(
      deriveMicState({
        isRecording: true,
        isThinking: false,
        isAudioPlaying: false,
        isCancelling: true,
      }),
    ).toBe<MicState>("cancelling")
  })

  it("processing beats speaking — thinking state means we have not received audio yet", () => {
    expect(
      deriveMicState({
        isRecording: false,
        isThinking: true,
        isAudioPlaying: true,
        isCancelling: false,
      }),
    ).toBe<MicState>("speaking")
  })

  it("all false → idle (boundary check)", () => {
    expect(
      deriveMicState({
        isRecording: false,
        isThinking: false,
        isAudioPlaying: false,
        isCancelling: false,
      }),
    ).toBe<MicState>("idle")
  })
})
