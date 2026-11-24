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

describe("AgentSession — usage_update handler", () => {
  it("מאכלס contextUsage עם update מלא (used/size/cost)", async () => {
    const session = await buildConnectedSession()
    expect(session.contextUsage).toBeNull()

    await inject({
      sessionUpdate: "usage_update",
      used: 25_000,
      size: 200_000,
      cost: { amount: 0.12, currency: "USD" },
    })

    expect(session.contextUsage).toEqual({
      used: 25_000,
      size: 200_000,
      cost: { amount: 0.12, currency: "USD" },
    })
  })

  it("שומר cost קודם כש-update חדש משמיט cost (anti-flicker)", async () => {
    const session = await buildConnectedSession()

    await inject({
      sessionUpdate: "usage_update",
      used: 10_000,
      size: 200_000,
      cost: { amount: 0.05, currency: "USD" },
    })
    expect(session.contextUsage?.cost).toEqual({ amount: 0.05, currency: "USD" })

    // update חדש בלי cost — לא אמור למחוק את ה-cost הקודם
    await inject({ sessionUpdate: "usage_update", used: 15_000, size: 200_000 })

    expect(session.contextUsage).toEqual({
      used: 15_000,
      size: 200_000,
      cost: { amount: 0.05, currency: "USD" },
    })
  })

  it("מעדכן נכון על פני כמה updates ברצף", async () => {
    const session = await buildConnectedSession()

    await inject({ sessionUpdate: "usage_update", used: 1_000, size: 200_000 })
    expect(session.contextUsage?.used).toBe(1_000)

    await inject({ sessionUpdate: "usage_update", used: 2_000, size: 200_000 })
    expect(session.contextUsage?.used).toBe(2_000)

    await inject({ sessionUpdate: "usage_update", used: 3_000, size: 200_000 })
    expect(session.contextUsage?.used).toBe(3_000)
  })

  it("size=0 לא קורס — הערך נשמר כפי שהוא (ה-UI אחראי ל-clamp/הסתרה)", async () => {
    const session = await buildConnectedSession()

    await inject({ sessionUpdate: "usage_update", used: 0, size: 0 })

    expect(session.contextUsage).toEqual({ used: 0, size: 0, cost: undefined })
  })

  it("פתיחת סשן חדש מאפסת contextUsage בהחלפת/פתיחת סשן", async () => {
    const session = await buildConnectedSession()

    await inject({
      sessionUpdate: "usage_update",
      used: 5_000,
      size: 200_000,
      cost: { amount: 0.02, currency: "USD" },
    })
    expect(session.contextUsage).not.toBeNull()

    // ניתוק ופתיחת סשן חדש → פתיחת סשן חדש מאפסת
    session.detach()
    await buildConnectedSession(session)

    expect(session.contextUsage).toBeNull()
  })

  it("#cleanup (detach) מאפס contextUsage", async () => {
    const session = await buildConnectedSession()

    await inject({ sessionUpdate: "usage_update", used: 5_000, size: 200_000 })
    expect(session.contextUsage).not.toBeNull()

    session.detach()

    expect(session.contextUsage).toBeNull()
  })
})
