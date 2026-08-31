/**
 * agent-session.context-usage.test.svelte.ts — TDD עבור handler של usage_update
 * (slice-session-budget-meter, Commit 1).
 *
 * מראה מדויק של agent-session.slash-commands.test.svelte.ts.
 *
 * מכסה (§4 Commit 1 / §5 DoD 3-4):
 *   (א) update מלא (used/size/cost) → contextUsage מאוכלס
 *   (ב) update ללא cost → cost קודם נשמר (anti-flicker)
 *   (ג) כמה updates ברצף — עדכון תקין
 *   (ד) size=0 — לא גורם קריסה/UI math לא תקין (הערך נשמר כפי-שהוא, ה-UI אחראי ל-clamp)
 *   (ה) session switch → #captureSessionConfig מאפס contextUsage
 *   (ו) detach → #cleanup מאפס contextUsage
 *
 * Testing: TDD (red→green)
 * דפוס: captured-listener + inject() (כמו agent-session.slash-commands.test.svelte.ts)
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
    sessionId: "s-context-usage-test",
    configOptions: [],
    models: null,
    modes: null,
  }),
  loadSession: vi.fn().mockResolvedValue({ sessionId: "s-context-usage-test" }),
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

vi.mock("@drive-coding/acp-wire/browser", () => ({
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
  createAgent: vi.fn().mockResolvedValue({ agentId: "agent-context-usage-test" }),
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

/** הזרקת SessionNotification דרך ה-captured listener — האמיתי, לא helper פנימי (brief §4) */
function inject(update: Record<string, unknown>): void {
  if (!capturedListener) throw new Error("listener not captured — attach() not called?")
  capturedListener({ update } as unknown as SessionNotification)
}

// ─── beforeEach ───────────────────────────────────────────────────────────────

beforeEach(() => {
  capturedListener = null
  mockClient.newSession.mockResolvedValue({
    sessionId: "s-context-usage-test",
    configOptions: [],
    models: null,
    modes: null,
  })
})

// ─── Tests — Commit 1: usage_update ────────────────────────────────────────────

describe("AgentSession — usage_update handler", () => {
  it("מאכלס contextUsage עם update מלא (used/size/cost)", async () => {
    const session = await buildConnectedSession()
    expect(session.contextUsage).toBeNull()

    inject({
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

    inject({
      sessionUpdate: "usage_update",
      used: 10_000,
      size: 200_000,
      cost: { amount: 0.05, currency: "USD" },
    })
    expect(session.contextUsage?.cost).toEqual({ amount: 0.05, currency: "USD" })

    // update חדש בלי cost — לא אמור למחוק את ה-cost הקודם
    inject({ sessionUpdate: "usage_update", used: 15_000, size: 200_000 })

    expect(session.contextUsage).toEqual({
      used: 15_000,
      size: 200_000,
      cost: { amount: 0.05, currency: "USD" },
    })
  })

  it("מעדכן נכון על פני כמה updates ברצף", async () => {
    const session = await buildConnectedSession()

    inject({ sessionUpdate: "usage_update", used: 1_000, size: 200_000 })
    expect(session.contextUsage?.used).toBe(1_000)

    inject({ sessionUpdate: "usage_update", used: 2_000, size: 200_000 })
    expect(session.contextUsage?.used).toBe(2_000)

    inject({ sessionUpdate: "usage_update", used: 3_000, size: 200_000 })
    expect(session.contextUsage?.used).toBe(3_000)
  })

  it("size=0 לא קורס — הערך נשמר כפי שהוא (ה-UI אחראי ל-clamp/הסתרה)", async () => {
    const session = await buildConnectedSession()

    expect(() => {
      inject({ sessionUpdate: "usage_update", used: 0, size: 0 })
    }).not.toThrow()

    expect(session.contextUsage).toEqual({ used: 0, size: 0, cost: undefined })
  })

  it("#captureSessionConfig מאפס contextUsage בהחלפת/פתיחת סשן", async () => {
    const session = await buildConnectedSession()

    inject({
      sessionUpdate: "usage_update",
      used: 5_000,
      size: 200_000,
      cost: { amount: 0.02, currency: "USD" },
    })
    expect(session.contextUsage).not.toBeNull()

    // ניתוק ופתיחת סשן חדש → #captureSessionConfig מאפס
    session.detach()
    await session.attach({ cwd: "/tmp2", cliKind: "opencode" })

    expect(session.contextUsage).toBeNull()
  })

  it("#cleanup (detach) מאפס contextUsage", async () => {
    const session = await buildConnectedSession()

    inject({ sessionUpdate: "usage_update", used: 5_000, size: 200_000 })
    expect(session.contextUsage).not.toBeNull()

    session.detach()

    expect(session.contextUsage).toBeNull()
  })
})
