/**
 * @vitest-environment jsdom
 * agent-voice.test.svelte.ts — the native-Live VM (slice codex-voice-poc).
 *
 * Adapters and the WebRTC engine are mocked. Besides the gating, the silent paths are pinned:
 * a failed start must surface as an error (not a call that never answers), and a pending
 * permission must be spoken once while the call is live.
 */

import { tick } from "svelte"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const adapter = vi.hoisted(() => ({
  startAgentVoice: vi.fn(async () => "answer"),
  stopAgentVoice: vi.fn(async () => {}),
  speakAgentVoice: vi.fn(async () => {}),
  loadNativeVoicePref: vi.fn(() => false),
  saveNativeVoicePref: vi.fn(),
}))
vi.mock("$lib/adapters/voice/agent-voice.js", () => adapter)

const engine = vi.hoisted(() => ({
  onEvent: null as null | ((e: unknown) => void),
  stop: vi.fn(),
  startRealtimeVoiceCall: vi.fn(),
}))
vi.mock("$lib/engines/realtime-voice-call.js", () => ({
  startRealtimeVoiceCall: engine.startRealtimeVoiceCall,
}))

import type { AgentSession } from "./agent-session.svelte"
import { AgentVoice } from "./agent-voice.svelte"

function makeSession(voice: boolean) {
  const s = $state({
    agentId: "agent-1" as string | null,
    sessionId: "sess-1" as string | null,
    capabilities: { voice } as { voice: boolean } | null,
    pendingPermission: null as null | { params: { toolCall?: { title?: string } } },
  })
  return s
}

function makeVoice(session: ReturnType<typeof makeSession>) {
  return new AgentVoice({
    session: session as unknown as AgentSession,
    getInstructions: () => "be brief",
    getPermissionSpeech: () => "approve on screen:",
  })
}

describe("AgentVoice", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    engine.startRealtimeVoiceCall.mockImplementation(
      async (opts: {
        negotiate: (s: string) => Promise<string>
        onEvent: (e: unknown) => void
      }) => {
        engine.onEvent = opts.onEvent
        await opts.negotiate("offer")
        return { stop: engine.stop }
      },
    )
  })
  afterEach(() => {
    engine.onEvent = null
  })

  it("is selected only when the provider supports voice and the user opted in", () => {
    const unsupported = makeVoice(makeSession(false))
    unsupported.setPreferNative(true)
    expect(unsupported.selected).toBe(false)
    const supported = makeVoice(makeSession(true))
    expect(supported.selected).toBe(false)
    supported.setPreferNative(true)
    expect(supported.selected).toBe(true)
    expect(adapter.saveNativeVoicePref).toHaveBeenLastCalledWith(true)
  })

  it("negotiates through _drive/voice/start with the session and instructions", async () => {
    const voice = makeVoice(makeSession(true))
    await voice.start()
    expect(adapter.startAgentVoice).toHaveBeenCalledWith("agent-1", "sess-1", "offer", "be brief")
    engine.onEvent?.({ type: "state", state: "live" })
    expect(voice.status).toBe("live")
    await voice.stop()
    expect(engine.stop).toHaveBeenCalled()
    expect(adapter.stopAgentVoice).toHaveBeenCalledWith("agent-1", "sess-1")
    expect(voice.status).toBe("idle")
  })

  it("surfaces a failed start as an error", async () => {
    adapter.startAgentVoice.mockRejectedValueOnce(new Error("_drive/voice/start: timed out"))
    const voice = makeVoice(makeSession(true))
    await voice.start()
    expect(voice.status).toBe("error")
    expect(voice.error).toMatch(/timed out/)
  })

  it("speaks a pending permission once while live", async () => {
    const session = makeSession(true)
    const voice = makeVoice(session)
    await voice.start()
    engine.onEvent?.({ type: "state", state: "live" })
    session.pendingPermission = { params: { toolCall: { title: "Write a.txt" } } }
    await tick()
    await tick()
    session.pendingPermission = { params: { toolCall: { title: "Write a.txt" } } }
    await tick()
    await tick()
    expect(adapter.speakAgentVoice).toHaveBeenCalledTimes(1)
    expect(adapter.speakAgentVoice).toHaveBeenCalledWith(
      "agent-1",
      "sess-1",
      "approve on screen: Write a.txt",
    )
    await voice.stop()
  })
})
