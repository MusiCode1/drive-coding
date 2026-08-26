/**
 * playback-dock-visibility.test.ts — showDock gate (slice playback-dock-scope, Commit 1).
 */
import { describe, expect, it } from "vitest"
import { shouldShowPlaybackDock } from "./playback-dock-visibility"

describe("shouldShowPlaybackDock", () => {
  it("typing + playlist items => false (fail gate)", () => {
    expect(
      shouldShowPlaybackDock({
        inputMode: "typing",
        playlistItemCount: 3,
        isRunActive: false,
      }),
    ).toBe(false)
  })

  it("record + playlist items => true", () => {
    expect(
      shouldShowPlaybackDock({
        inputMode: "record",
        playlistItemCount: 2,
        isRunActive: false,
      }),
    ).toBe(true)
  })

  it("record + empty playlist + active run => true", () => {
    expect(
      shouldShowPlaybackDock({
        inputMode: "record",
        playlistItemCount: 0,
        isRunActive: true,
      }),
    ).toBe(true)
  })

  it("record + empty playlist + no run => false", () => {
    expect(
      shouldShowPlaybackDock({
        inputMode: "record",
        playlistItemCount: 0,
        isRunActive: false,
      }),
    ).toBe(false)
  })

  it("hidden + playlist items => false", () => {
    expect(
      shouldShowPlaybackDock({
        inputMode: "hidden",
        playlistItemCount: 5,
        isRunActive: false,
      }),
    ).toBe(false)
  })

  it("typing + active run => false", () => {
    expect(
      shouldShowPlaybackDock({
        inputMode: "typing",
        playlistItemCount: 0,
        isRunActive: true,
      }),
    ).toBe(false)
  })
})
