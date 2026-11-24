import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createRemoteView } from "$lib/session/create-session-view"
import { MockSessionView } from "$lib/view-models/__fixtures__/mock-session-view.svelte"
import { AgentSession } from "$lib/view-models/agent-session.svelte"
import type { Settings } from "$lib/view-models/settings.svelte"
import { connectAgent } from "./connect-agent"

vi.mock("$app/navigation", () => ({ goto: vi.fn() }))
vi.mock("$env/dynamic/public", () => ({ env: {} }))
vi.mock("$lib/session/create-session-view")
vi.mock("$lib/adapters/agents-api", () => ({
  createAgent: vi.fn().mockResolvedValue({ agentId: "agent-1" }),
}))

describe("connectAgent transport", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("location", { search: "", protocol: "http:", host: "localhost" })
    vi.stubGlobal("sessionStorage", { getItem: () => null })
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each(["ws", "http"] as const)("opens the session view with %s", async (transport) => {
    const view = new MockSessionView()
    view.connect("session-1")
    vi.mocked(createRemoteView).mockResolvedValue(
      view as unknown as Awaited<ReturnType<typeof createRemoteView>>,
    )
    const session = new AgentSession()
    const settings = {
      sessionTransport: transport,
      setCliKind: vi.fn(),
      setLastCwd: vi.fn(),
      getProjectPrompt: () => null,
    } as unknown as Settings

    await connectAgent({ cliKind: "codex", cwd: "/project", session, settings })

    expect(createRemoteView).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent-1",
        transport,
      }),
    )
    expect(session.status).toBe("connected")
  })
})
