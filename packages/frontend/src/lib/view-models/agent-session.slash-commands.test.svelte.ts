/**
 * agent-session.slash-commands.test.svelte.ts — TDD עבור handler של available_commands_update
 * (slice-slash-commands, Commit 0).
 *
 * מראה מדויק של agent-session.mode-config-sync.test.svelte.ts.
 *
 * מכסה (§5 DoD / §4 Commit 0):
 *   (א) update מאכלס availableCommands
 *   (ב) update עם payload ריק/לא-מערך → []
 *   (ג) #captureSessionConfig מאפס ל-[] בהחלפת/פתיחת סשן
 *   (ד) update שאינו-מערך → [] בלי crash
 *
 * Testing: TDD (red→green)
 * דפוס: captured-listener + inject() (כמו agent-session.mode-config-sync.test.svelte.ts)
 */

import type { SessionNotification } from "@agentclientprotocol/sdk"
import type { AcpClient } from "@drive-coding/provider/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

// ─── Module-level mocks ───────────────────────────────────────────────────────

let capturedListener: ((n: SessionNotification) => void) | null = null

const mockClient = {
  prompt: vi.fn().mockResolvedValue(undefined),
  cancel: vi.fn().mockResolvedValue(undefined),
  newSession: vi.fn().mockResolvedValue({
    sessionId: "s-slash-test",
    configOptions: [],
    models: null,
    modes: null,
  }),
  loadSession: vi.fn().mockResolvedValue({ sessionId: "s-slash-test" }),
  listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
  setSessionConfigOption: vi.fn().mockResolvedValue({ configOptions: [] }),
  setSessionModel: vi.fn().mockResolvedValue(undefined),
  setSessionMode: vi.fn().mockResolvedValue(undefined),
  close: vi.fn(),
}

vi.mock("@drive-coding/provider/client", async (importActual) => {
  const actual = await importActual<typeof import("@drive-coding/provider/client")>()
  return {
    ...actual,
    createAcpClient: vi.fn(function mockCreateClient(
      _transport: unknown,
      callbackOrCallbacks:
        | ((n: SessionNotification) => void)
        | { onUpdate: (n: SessionNotification) => void; onExtNotification?: unknown },
    ): Promise<AcpClient> {
      capturedListener =
        typeof callbackOrCallbacks === "function"
          ? callbackOrCallbacks
          : callbackOrCallbacks.onUpdate
      return Promise.resolve(mockClient as unknown as AcpClient)
    }),
  }
})

vi.mock("$lib/engines/ws-transport", () => ({
  WsAcpTransport: vi.fn(function mockWsTransport() {
    return {
      onClose: vi.fn(),
      waitForOpen: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      closeAndWait: vi.fn().mockResolvedValue(undefined),
    }
  }),
}))

vi.mock("$lib/adapters/agents-api", () => ({
  createAgent: vi.fn().mockResolvedValue({ agentId: "agent-slash-test" }),
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  notifySessionAttached: vi.fn().mockResolvedValue(undefined),
  listAgents: vi.fn().mockResolvedValue([]),
}))

vi.mock("$lib/adapters/sessions", () => ({
  normalizeSessionInfo: vi.fn((x: unknown) => x),
}))

vi.stubGlobal("location", {
  protocol: "http:",
  host: "localhost:5173",
  search: "",
})

vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("test-uuid") })

// ─── Import after mocks ───────────────────────────────────────────────────────

import { AgentSession } from "./agent-session.svelte"

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** יצירת AgentSession מחובר */
async function buildConnectedSession(): Promise<AgentSession> {
  const session = new AgentSession()
  await session.attach({ cwd: "/tmp", cliKind: "opencode" })
  if (session.status !== "connected") {
    throw new Error(`attach failed: status=${session.status} error=${session.error}`)
  }
  return session
}

/** הזרקת SessionNotification דרך ה-captured listener */
function inject(update: Record<string, unknown>): void {
  if (!capturedListener) throw new Error("listener not captured — attach() not called?")
  capturedListener({ update } as unknown as SessionNotification)
}

// ─── beforeEach ───────────────────────────────────────────────────────────────

beforeEach(() => {
  capturedListener = null
  mockClient.newSession.mockResolvedValue({
    sessionId: "s-slash-test",
    configOptions: [],
    models: null,
    modes: null,
  })
})

// ─── Tests — Commit 0: available_commands_update ──────────────────────────────

describe("AgentSession — available_commands_update handler", () => {
  it("מאכלס availableCommands כשמגיע available_commands_update", async () => {
    const session = await buildConnectedSession()
    expect(session.availableCommands).toEqual([])

    const cmds = [
      { name: "commit", description: "Create a git commit" },
      { name: "code-review", description: "Review the current diff" },
    ]
    inject({ sessionUpdate: "available_commands_update", availableCommands: cmds })

    expect(session.availableCommands).toEqual(cmds)
  })

  it("מאפס ל-[] כש-availableCommands ב-payload ריק", async () => {
    const session = await buildConnectedSession()

    inject({
      sessionUpdate: "available_commands_update",
      availableCommands: [{ name: "commit", description: "x" }],
    })
    expect(session.availableCommands).toHaveLength(1)

    inject({ sessionUpdate: "available_commands_update", availableCommands: [] })
    expect(session.availableCommands).toEqual([])
  })

  it("לא קורס ומאפס ל-[] כש-availableCommands אינו מערך", async () => {
    const session = await buildConnectedSession()

    inject({
      sessionUpdate: "available_commands_update",
      availableCommands: [{ name: "commit", description: "x" }],
    })
    expect(session.availableCommands).toHaveLength(1)

    expect(() => {
      inject({ sessionUpdate: "available_commands_update", availableCommands: "not-an-array" })
    }).not.toThrow()

    expect(session.availableCommands).toEqual([])
  })

  it("#captureSessionConfig מאפס availableCommands ל-[] בפתיחת/החלפת סשן", async () => {
    const session = await buildConnectedSession()

    inject({
      sessionUpdate: "available_commands_update",
      availableCommands: [{ name: "commit", description: "x" }],
    })
    expect(session.availableCommands).toHaveLength(1)

    // ניתוק ופתיחת סשן חדש → #captureSessionConfig מאפס
    session.detach()
    await session.attach({ cwd: "/tmp2", cliKind: "opencode" })

    expect(session.availableCommands).toEqual([])
  })
})
