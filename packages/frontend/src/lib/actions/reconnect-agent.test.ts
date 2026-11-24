import type { AgentPublic } from "@drive-coding/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createRemoteView } from "$lib/session/create-session-view"
import { MockSessionView } from "$lib/view-models/__fixtures__/mock-session-view.svelte"
import { AgentSession } from "$lib/view-models/agent-session.svelte"
import type { Settings } from "$lib/view-models/settings.svelte"
import { reconnectAgent } from "./reconnect-agent"

vi.mock("$env/dynamic/public", () => ({ env: {} }))
vi.mock("$lib/session/create-session-view")

describe("reconnectAgent transport", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("location", { search: "" })
    vi.stubGlobal("sessionStorage", { getItem: () => null })
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each(["ws", "http"] as const)("reattaches to the live agent with %s", async (transport) => {
    const view = new MockSessionView()
    view.connect("session-1")
    vi.mocked(createRemoteView).mockResolvedValue(
      view as unknown as Awaited<ReturnType<typeof createRemoteView>>,
    )
    const agent: AgentPublic = {
      id: "agent-1",
      cliKind: "codex",
      cwd: "/project",
      modelOverride: null,
      status: "starting",
      createdAt: "2026-01-01T00:00:00.000Z",
    }
    const session = new AgentSession()
    const settings = { sessionTransport: transport } as unknown as Settings

    expect(await reconnectAgent({ agent, session, settings })).toBe("navigated")
    expect(createRemoteView).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent-1",
        transport,
      }),
    )
  })
})
