/**
 * agent-session.mode-config-sync.test.svelte.ts — TDD עבור handlers של mode/config events
 * (slice-acp-mode-config-sync).
 *
 * מכסה (§5 DoD):
 *   1. current_mode_update מעדכן modes.currentModeId [commit 0]
 *   2. availableModes נשמר בעדכון mode [commit 0]
 *   3. modes===null לא קורס בעדכון mode [commit 0]
 *   4. config_option_update מחליף configOptions [commit 1]
 *   5. events לא-מטופלים אחרים לא נשברים (טסטים קיימים — ירוקים)
 *
 * Testing: TDD (red→green per commit)
 * דפוס: captured-listener + inject() (כמו agent-session.turnstate.test.svelte.ts:46-73,126-130)
 */

import type { SessionNotification } from "@agentclientprotocol/sdk"
import type { AcpClient } from "provider-contract/acp"
import { beforeEach, describe, expect, it, vi } from "vitest"

// ─── Module-level mocks ───────────────────────────────────────────────────────

let capturedListener: ((n: SessionNotification) => void) | null = null

const mockClient = {
  prompt: vi.fn().mockResolvedValue(undefined),
  cancel: vi.fn().mockResolvedValue(undefined),
  newSession: vi.fn().mockResolvedValue({
    sessionId: "s-mode-test",
    configOptions: [],
    models: null,
    modes: null,
  }),
  loadSession: vi.fn().mockResolvedValue({ sessionId: "s-mode-test" }),
  listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
  setSessionConfigOption: vi.fn().mockResolvedValue({ configOptions: [] }),
  setSessionModel: vi.fn().mockResolvedValue(undefined),
  setSessionMode: vi.fn().mockResolvedValue(undefined),
  close: vi.fn(),
}

vi.mock("provider-contract/acp", async (importActual) => {
  const actual = await importActual<typeof import("provider-contract/acp")>()
  return {
    ...actual,
    createAcpClient: vi.fn(function mockCreateClient(
      _transport: unknown,
      listener: (n: SessionNotification) => void,
    ): Promise<AcpClient> {
      capturedListener = listener
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
  createAgent: vi.fn().mockResolvedValue({ agentId: "agent-mode-test" }),
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
    sessionId: "s-mode-test",
    configOptions: [],
    models: null,
    modes: null,
  })
})

// ─── Tests — Commit 0: current_mode_update ────────────────────────────────────

describe("AgentSession — current_mode_update handler", () => {
  it("מעדכן currentModeId כשמגיע current_mode_update", async () => {
    // זרע modes ראשוני דרך newSession
    mockClient.newSession.mockResolvedValue({
      sessionId: "s-mode-test",
      configOptions: [],
      models: null,
      modes: {
        availableModes: [
          { id: "default", name: "Default" },
          { id: "bypassPermissions", name: "Bypass" },
        ],
        currentModeId: "default",
      },
    })

    const session = await buildConnectedSession()
    expect(session.modes?.currentModeId).toBe("default")

    // inject event
    inject({ sessionUpdate: "current_mode_update", currentModeId: "bypassPermissions" })

    expect(session.modes?.currentModeId).toBe("bypassPermissions")
  })

  it("שומר availableModes לאחר עדכון currentModeId", async () => {
    mockClient.newSession.mockResolvedValue({
      sessionId: "s-mode-test",
      configOptions: [],
      models: null,
      modes: {
        availableModes: [
          { id: "default", name: "Default" },
          { id: "bypassPermissions", name: "Bypass" },
        ],
        currentModeId: "default",
      },
    })

    const session = await buildConnectedSession()
    const originalAvailable = session.modes?.availableModes

    inject({ sessionUpdate: "current_mode_update", currentModeId: "bypassPermissions" })

    // availableModes לא נמחק
    expect(session.modes?.availableModes).toEqual(originalAvailable)
    expect(session.modes?.availableModes).toHaveLength(2)
  })

  it("לא קורס כש-modes===null לפני העדכון (מגדיר currentModeId עם availableModes ריק)", async () => {
    // modes=null בברירת מחדל (כבר מוגדר ב-beforeEach)
    const session = await buildConnectedSession()
    expect(session.modes).toBeNull()

    // לא צריך לזרוק
    expect(() => {
      inject({ sessionUpdate: "current_mode_update", currentModeId: "bypassPermissions" })
    }).not.toThrow()

    expect(session.modes?.currentModeId).toBe("bypassPermissions")
    expect(session.modes?.availableModes).toEqual([])
  })

  it("מתעלם מ-current_mode_update עם currentModeId לא-string", async () => {
    mockClient.newSession.mockResolvedValue({
      sessionId: "s-mode-test",
      configOptions: [],
      models: null,
      modes: {
        availableModes: [{ id: "default", name: "Default" }],
        currentModeId: "default",
      },
    })

    const session = await buildConnectedSession()

    // inject עם ערך לא-תקף — לא אמור לשנות כלום
    expect(() => {
      inject({ sessionUpdate: "current_mode_update", currentModeId: 42 })
    }).not.toThrow()

    // מצב נשמר
    expect(session.modes?.currentModeId).toBe("default")
  })
})

// ─── Tests — Commit 1: config_option_update (יתווסף ב-commit הבא) ────────────
