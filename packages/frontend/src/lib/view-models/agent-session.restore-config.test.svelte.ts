import type { SessionState } from "@drive-coding/core/session"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createRemoteView } from "$lib/session/create-session-view"
import type { Settings } from "$lib/view-models/settings.svelte"
import { MockSessionView } from "./__fixtures__/mock-session-view.svelte"
import { AgentSession } from "./agent-session.svelte"

vi.mock("$lib/session/create-session-view")
vi.mock("$lib/adapters/agents-api", () => ({
  createAgent: vi.fn().mockResolvedValue({ agentId: "test-agent" }),
}))

const cwd = "/project"
const cliKind = "opencode"
const modes = { currentModeId: "ask", availableModes: [{ id: "ask", name: "Ask" }] }

function settingsFor(lastConfig: Record<string, Record<string, string | boolean>>) {
  return { lastConfig, setLastConfig: vi.fn() } as unknown as Settings
}

describe("restoring remembered session configuration", () => {
  let view: MockSessionView

  beforeEach(() => {
    vi.stubGlobal("location", { protocol: "http:", host: "localhost" })
    view = new MockSessionView()
    view.connect("first")
    vi.mocked(createRemoteView).mockResolvedValue(
      view as unknown as Awaited<ReturnType<typeof createRemoteView>>,
    )
  })

  afterEach(() => vi.unstubAllGlobals())

  async function attach(state: Partial<SessionState>, settings?: Settings) {
    view.state = { ...view.state, ...state }
    const session = new AgentSession({ settings })
    await session.attachRemote({ cwd, cliKind, transport: "ws" })
    expect(session.status).toBe("connected")
    return session
  }

  it("applies a remembered valid mode once attached", async () => {
    await attach({ modes }, settingsFor({ opencode: { mode: "ask" } }))
    expect(view.setModeMock).toHaveBeenCalledExactlyOnceWith("ask")
  })

  it("skips a remembered mode that the session does not offer", async () => {
    await attach({ modes }, settingsFor({ opencode: { mode: "obsolete" } }))
    expect(view.setModeMock).not.toHaveBeenCalled()
  })

  it("does not send a mode when settings are absent", async () => {
    await attach({ modes })
    expect(view.setModeMock).not.toHaveBeenCalled()
  })

  it("reads remembered configuration for the active provider", async () => {
    await attach({ modes }, settingsFor({ claude: { mode: "ask" } }))
    expect(view.setModeMock).not.toHaveBeenCalled()
  })

  it("restores a boolean config option through the session view", async () => {
    await attach(
      {
        configOptions: [{ id: "myToggle", type: "boolean", name: "Toggle", currentValue: false }],
      },
      settingsFor({ opencode: { myToggle: true } }),
    )
    expect(view.setConfigOptionMock).toHaveBeenCalledExactlyOnceWith("myToggle", true)
  })

  it("restores a mode available in the new session after its RPC", async () => {
    const session = await attach({}, settingsFor({ opencode: { mode: "ask" } }))
    expect(view.setModeMock).not.toHaveBeenCalled()
    view.newSessionMock.mockImplementationOnce(async () => {
      view.connect("second")
      view.applyAndEmit({ version: 1, op: "update-session", changes: { modes } })
    })

    await session.newSession({ cwd, cliKind })

    expect(session.sessionId).toBe("second")
    expect(view.setModeMock).toHaveBeenCalledExactlyOnceWith("ask")
  })

  it("leaves the mode of a resumed session intact", async () => {
    const session = await attach({}, settingsFor({ opencode: { mode: "ask" } }))
    view.loadSessionMock.mockImplementationOnce(async (sessionId: string) => {
      view.connect(sessionId)
      view.applyAndEmit({ version: 1, op: "update-session", changes: { modes } })
    })

    await session.switchSession({ sessionId: "resumed", cwd, cliKind })

    expect(session.sessionId).toBe("resumed")
    expect(session.modes?.availableModes).toEqual(modes.availableModes)
    expect(view.setModeMock).not.toHaveBeenCalled()
  })
})
