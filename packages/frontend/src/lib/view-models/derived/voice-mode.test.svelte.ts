/**
 * voice-mode.test.svelte.ts — T1/T2/T2b/T3/T5 for control-roles slice.
 *
 * ─── slice control-roles ───
 */

import { describe, expect, it, vi } from "vitest"
import type { AudioPlaylist } from "$lib/engines/audio-playlist.svelte"
import type { AgentSession } from "../agent-session.svelte"
import type { Mic } from "../mic.svelte"
import type { Speaker } from "../speaker.svelte"
import { VoiceMode } from "./voice-mode.svelte"

function mocks() {
  const mic = $state({ state: "idle", toggle: vi.fn(async () => {}), cancel: vi.fn() })
  const session = $state({ turnState: "idle", cancelTurn: vi.fn(async () => {}) })
  const speaker = $state({ state: "idle", enabled: true, stop: vi.fn() })
  const playlist = $state({ transport: "playing" as "playing" | "paused" | "stopped" })
  return { mic, session, speaker, playlist }
}

function makeVoiceMode(m: ReturnType<typeof mocks>): VoiceMode {
  return new VoiceMode({
    mic: m.mic as unknown as Mic,
    session: m.session as unknown as AgentSession,
    speaker: m.speaker as unknown as Speaker,
    playlist: m.playlist as unknown as AudioPlaylist,
  })
}

describe("VoiceMode.startTalking", () => {
  it("barge-in when speaking and transport playing — stops speaker, toggles mic, no cancelTurn", () => {
    const m = mocks()
    m.speaker.state = "speaking"
    m.playlist.transport = "playing"
    const vm = makeVoiceMode(m)

    void vm.startTalking()

    expect(m.speaker.stop).toHaveBeenCalled()
    expect(m.mic.toggle).toHaveBeenCalled()
    expect(m.session.cancelTurn).not.toHaveBeenCalled()
  })

  it("idle speaker — mic.toggle only, no speaker.stop", () => {
    const m = mocks()
    m.speaker.state = "idle"
    const vm = makeVoiceMode(m)

    void vm.startTalking()

    expect(m.mic.toggle).toHaveBeenCalled()
    expect(m.speaker.stop).not.toHaveBeenCalled()
    expect(m.session.cancelTurn).not.toHaveBeenCalled()
  })

  it("speaking but paused transport — mic.toggle only, no speaker.stop", () => {
    const m = mocks()
    m.speaker.state = "speaking"
    m.playlist.transport = "paused"
    const vm = makeVoiceMode(m)

    void vm.startTalking()

    expect(m.mic.toggle).toHaveBeenCalled()
    expect(m.speaker.stop).not.toHaveBeenCalled()
    expect(m.session.cancelTurn).not.toHaveBeenCalled()
  })
})

describe("VoiceMode.cancelRun", () => {
  it("recording — does not call mic.cancel", () => {
    const m = mocks()
    m.mic.state = "recording"
    const vm = makeVoiceMode(m)

    vm.cancelRun()

    expect(m.mic.cancel).not.toHaveBeenCalled()
    expect(m.speaker.stop).toHaveBeenCalled()
    expect(m.session.cancelTurn).toHaveBeenCalled()
  })

  it("idle mic — calls mic.cancel", () => {
    const m = mocks()
    m.mic.state = "idle"
    const vm = makeVoiceMode(m)

    vm.cancelRun()

    expect(m.mic.cancel).toHaveBeenCalled()
    expect(m.speaker.stop).toHaveBeenCalled()
    expect(m.session.cancelTurn).toHaveBeenCalled()
  })
})

describe("VoiceMode.canClearCancelling", () => {
  it("true when turnState and speaker idle even if mic still recording", () => {
    const m = mocks()
    m.session.turnState = "idle"
    m.speaker.state = "idle"
    m.mic.state = "recording"
    const vm = makeVoiceMode(m)

    expect(vm.canClearCancelling).toBe(true)

    m.speaker.state = "speaking"
    expect(vm.canClearCancelling).toBe(false)
  })
})
