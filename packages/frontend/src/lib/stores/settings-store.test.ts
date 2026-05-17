/**
 * settings-store.test.ts — Phase 12 TDD
 *
 * Tests for persisted settings store.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { settingsStore } from "./settings-store.svelte"

describe("settingsStore (Phase 12)", () => {
  afterEach(() => {
    settingsStore.reset()
    vi.restoreAllMocks()
  })

  // ── 1: default voiceId ────────────────────────────────────────────────────
  it("has a default voiceId (Sarah)", () => {
    settingsStore.reset()
    expect(settingsStore.voiceId).toBe("EXAVITQu4vr4xnSDxMaL")
  })

  // ── 2: setVoiceId updates voiceId ─────────────────────────────────────────
  it("setVoiceId updates voiceId", () => {
    settingsStore.setVoiceId("new-voice-id")
    expect(settingsStore.voiceId).toBe("new-voice-id")
  })

  // ── 3: thoughtVoiceId defaults to 'same' ──────────────────────────────────
  it("thoughtVoiceId defaults to 'same'", () => {
    settingsStore.reset()
    expect(settingsStore.thoughtVoiceId).toBe("same")
  })

  // ── 4: setAudioCue updates specific cue ───────────────────────────────────
  it("setAudioCue updates specific cue while preserving others", () => {
    settingsStore.reset()
    settingsStore.setAudioCue("recordingStart", false)
    expect(settingsStore.audioCues.recordingStart).toBe(false)
    // Other cues unchanged
    expect(settingsStore.audioCues.thinking).toBe(true)
    expect(settingsStore.audioCues.speaking).toBe(true)
  })

  // ── 5: reset restores defaults ────────────────────────────────────────────
  it("reset restores all defaults", () => {
    settingsStore.setVoiceId("custom")
    settingsStore.setAudioCue("speaking", false)
    settingsStore.reset()
    expect(settingsStore.voiceId).toBe("EXAVITQu4vr4xnSDxMaL")
    expect(settingsStore.audioCues.speaking).toBe(true)
  })
})
