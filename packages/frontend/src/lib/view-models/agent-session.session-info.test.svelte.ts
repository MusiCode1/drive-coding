import { afterEach, describe, expect, it, vi } from "vitest"
import { patchAgent } from "$lib/adapters/agents-api"
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

describe("AgentSession — session_info_update handler", () => {
  it("קובע sessionTitle כש-title הוא string", async () => {
    const session = await buildConnectedSession()

    await inject({ sessionUpdate: "session_info_update", title: "Fix auth bug" })

    expect(session.sessionTitle).toBe("Fix auth bug")
  })

  it("מנקה sessionTitle ל-'' כש-title הוא null", async () => {
    const session = await buildConnectedSession()

    await inject({ sessionUpdate: "session_info_update", title: "Fix auth bug" })
    expect(session.sessionTitle).toBe("Fix auth bug")

    await inject({ sessionUpdate: "session_info_update", title: null })

    expect(session.sessionTitle).toBe("")
  })

  it("שומר sessionTitle כש-title הוא undefined (keep-on-undefined)", async () => {
    const session = await buildConnectedSession()

    await inject({ sessionUpdate: "session_info_update", title: "Fix auth bug" })
    expect(session.sessionTitle).toBe("Fix auth bug")

    // update בלי title בכלל (שדה חסר) — לא אמור למחוק את הכותרת הקודמת
    await inject({ sessionUpdate: "session_info_update" })

    expect(session.sessionTitle).toBe("Fix auth bug")
  })

  it("after setManualTitle, session_info_update string does not change sessionTitle", async () => {
    const session = await buildConnectedSession()
    session.setManualTitle("User title")
    expect(session.sessionTitle).toBe("User title")

    await inject({ sessionUpdate: "session_info_update", title: "ACP overwrite" })
    expect(session.sessionTitle).toBe("User title")
  })

  it("after setManualTitle, session_info_update null does not clear sessionTitle", async () => {
    const session = await buildConnectedSession()
    session.setManualTitle("User title")

    await inject({ sessionUpdate: "session_info_update", title: null })
    expect(session.sessionTitle).toBe("User title")
  })
})

// ─── slice http-live-side-effects C0: remote session_info_update → patchAgent ───

describe("AgentSession — session_info_update handler", () => {
  it("קורא ל-patchAgent כש-title מתעדכן דרך ה-host", async () => {
    const session = await buildConnectedSession()
    session.agentId = "agent-remote-title-test"

    await inject({ sessionUpdate: "session_info_update", title: "Fix auth bug" })

    expect(session.sessionTitle).toBe("Fix auth bug")
    expect(patchAgent).toHaveBeenCalledWith("agent-remote-title-test", { title: "Fix auth bug" })
  })
})
