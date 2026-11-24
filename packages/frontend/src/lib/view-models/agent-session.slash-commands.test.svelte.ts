import { afterEach, describe, expect, it, vi } from "vitest"
import { createRemoteView } from "$lib/session/create-session-view"
import { hostSessionView } from "./__fixtures__/host-session-view"
import { AgentSession } from "./agent-session.svelte"

vi.mock("$lib/session/create-session-view", async (original) => ({
  ...(await original<typeof import("$lib/session/create-session-view")>()),
  createRemoteView: vi.fn(),
}))
vi.mock("$lib/adapters/agents-api", () => ({
  createAgent: vi.fn().mockResolvedValue({ agentId: "test-agent" }),
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  patchAgent: vi.fn().mockResolvedValue(undefined),
}))

let host: ReturnType<typeof hostSessionView>

async function buildConnectedSession(session = new AgentSession()) {
  host = hostSessionView()
  await host.view.connect()
  vi.mocked(createRemoteView).mockResolvedValue(host.view)
  await session.attachRemote({ cwd: "/project", cliKind: "opencode", transport: "http" })
  return session
}

async function inject(update: unknown): Promise<void> {
  host.send(update)
  await new Promise((resolve) => setTimeout(resolve, 0))
}

afterEach(async () => {
  await host?.view.close()
  vi.clearAllMocks()
})

describe("AgentSession — available_commands_update handler", () => {
  it("מאכלס availableCommands כשמגיע available_commands_update", async () => {
    const session = await buildConnectedSession()
    expect(session.availableCommands).toEqual([])

    const cmds = [
      { name: "commit", description: "Create a git commit" },
      { name: "code-review", description: "Review the current diff" },
    ]
    await inject({ sessionUpdate: "available_commands_update", availableCommands: cmds })

    expect(session.availableCommands).toEqual(cmds)
  })

  it("מאפס ל-[] כש-availableCommands ב-payload ריק", async () => {
    const session = await buildConnectedSession()

    await inject({
      sessionUpdate: "available_commands_update",
      availableCommands: [{ name: "commit", description: "x" }],
    })
    expect(session.availableCommands).toHaveLength(1)

    await inject({ sessionUpdate: "available_commands_update", availableCommands: [] })
    expect(session.availableCommands).toEqual([])
  })

  it("לא קורס ומאפס ל-[] כש-availableCommands אינו מערך", async () => {
    const session = await buildConnectedSession()

    await inject({
      sessionUpdate: "available_commands_update",
      availableCommands: [{ name: "commit", description: "x" }],
    })
    expect(session.availableCommands).toHaveLength(1)

    await inject({ sessionUpdate: "available_commands_update", availableCommands: "not-an-array" })

    expect(session.availableCommands).toEqual([])
  })

  it("פתיחת סשן חדש מאפסת availableCommands ל-[] בפתיחת/החלפת סשן", async () => {
    const session = await buildConnectedSession()

    await inject({
      sessionUpdate: "available_commands_update",
      availableCommands: [{ name: "commit", description: "x" }],
    })
    expect(session.availableCommands).toHaveLength(1)

    // ניתוק ופתיחת סשן חדש → פתיחת סשן חדש מאפסת
    session.detach()
    await buildConnectedSession(session)

    expect(session.availableCommands).toEqual([])
  })
})
