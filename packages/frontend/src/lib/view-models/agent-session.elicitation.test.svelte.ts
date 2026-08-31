/**
 * agent-session.elicitation.test.svelte.ts — integration tests לתשתית שאלה מובנת חיה
 * (slice-elicitation-ui Commit 2).
 *
 * דפוס: agent-session.permission.test.svelte.ts (מוק createAcpClient, לוכד callbacks) —
 * מחקה 1:1. הסיכון המרכזי (§4 Commit 2 / §6, יורש מ-A1): Promise תלוי — teardown/reconnect
 * חייבים לפתור pendingElicitation, אחרת turn נתקע. הטסטים כאן מכסים את כל נקודות
 * ה-#client=null: #cleanup (detach/leaveRunning), cancelTurn, ו-#doReconnect (reconnect path
 * אחד לדוגמה — שלושת ה-reconnect paths חולקים את אותו #resolvePendingElicitation).
 *
 * Tests:
 *   1. #onCreateElicitation (דרך callback שנלכד) קובע pendingElicitation עם params.
 *   2. resolveElicitation(content) פותר את ה-Promise עם accept+content, מאפס pendingElicitation.
 *   3. cancelElicitation("decline") פותר כ-decline, מאפס pendingElicitation.
 *   4. cancelElicitation("cancel") פותר כ-cancel, מאפס pendingElicitation.
 *   5. בקשה שנייה בזמן pending → הראשונה נפתרת cancel, השנייה הופכת pending (מחקה DoD#8 permission).
 *   6. detach() באמצע pending → נפתר cancel, אין תקיעה (DoD#5).
 *   7. leaveRunning() באמצע pending → נפתר cancel (גם הוא דרך #cleanup).
 *   8. cancelTurn() באמצע pending → נפתר cancel (נתיב עצמאי, לא #cleanup).
 *   9. reconnect: #doReconnect עם #transport חי → pending נפתר cancel לפני warm/cold.
 */

import type { AcpClient } from "@drive-coding/provider/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

// ─── Module-level mocks ───────────────────────────────────────────────────────

type OnCreateElicitation = (params: unknown) => Promise<unknown>

/** onCreateElicitation callback captured from createAcpClient call */
let capturedOnCreateElicitation: OnCreateElicitation | null = null

const mockClient: AcpClient = {
  conn: {} as AcpClient["conn"],
  capabilities: {} as AcpClient["capabilities"],
  newSession: vi.fn().mockResolvedValue({ sessionId: "session-elic-test" }),
  loadSession: vi.fn().mockResolvedValue({}),
  listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
  prompt: vi.fn().mockResolvedValue(undefined),
  cancel: vi.fn().mockResolvedValue(undefined),
  close: vi.fn(),
  setSessionConfigOption: vi.fn(),
  setSessionMode: vi.fn(),
  setSessionModel: vi.fn(),
  extMethod: vi.fn().mockResolvedValue({ ok: true }),
} as unknown as AcpClient

vi.mock("@drive-coding/provider/client", async (importActual) => {
  const actual = await importActual<typeof import("@drive-coding/provider/client")>()
  return {
    ...actual,
    createAcpClient: vi.fn(
      (
        _transport: unknown,
        callbacks: { onUpdate: unknown; onCreateElicitation?: OnCreateElicitation },
      ) => {
        if (typeof callbacks === "object" && callbacks !== null) {
          capturedOnCreateElicitation = callbacks.onCreateElicitation ?? null
        }
        return Promise.resolve(mockClient)
      },
    ),
  }
})

vi.mock("@drive-coding/acp-wire", () => ({
  WsAcpTransport: vi.fn(function mockWsTransport() {
    return {
      onClose: vi.fn(),
      waitForOpen: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      closeAndWait: vi.fn().mockResolvedValue(undefined),
      sendRaw: vi.fn(),
    }
  }),
}))

vi.mock("$lib/adapters/agents-api", () => ({
  createAgent: vi.fn().mockResolvedValue({ agentId: "agent-elic-test" }),
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  notifySessionAttached: vi.fn().mockResolvedValue(undefined),
  listAgents: vi.fn().mockResolvedValue([]),
}))

vi.mock("$lib/adapters/sessions", () => ({
  normalizeSessionInfo: vi.fn((x: unknown) => x),
}))

vi.mock("$lib/adapters/ext", () => ({
  createExtClient: vi.fn(() => ({})),
}))

vi.stubGlobal("location", { protocol: "http:", host: "localhost:5173", search: "" })
vi.stubGlobal("crypto", { randomUUID: () => "test-uuid" })

// ─── Import after mocks ───────────────────────────────────────────────────────
import { AgentSession } from "./agent-session.svelte"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function elicitationParams(message = "What is your name?") {
  return {
    sessionId: "session-elic-test",
    mode: "form",
    message,
    requestedSchema: {
      type: "object",
      properties: { name: { type: "string" } },
    },
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AgentSession — elicitation round-trip (slice-elicitation-ui Commit 2)", () => {
  let session: AgentSession

  beforeEach(async () => {
    capturedOnCreateElicitation = null
    ;(mockClient.close as ReturnType<typeof vi.fn>).mockClear()
    session = new AgentSession()
    await session.attach({ cwd: "/some/cwd", cliKind: "claude" })
    expect(capturedOnCreateElicitation).not.toBeNull()
  })

  it("1. #onCreateElicitation sets pendingElicitation with params", () => {
    void capturedOnCreateElicitation?.(elicitationParams())
    expect(session.pendingElicitation).not.toBeNull()
    expect(session.pendingElicitation?.params).toEqual(elicitationParams())
  })

  it("2. resolveElicitation(content) resolves accept outcome, resets pendingElicitation", async () => {
    const resultPromise = capturedOnCreateElicitation?.(elicitationParams())
    expect(session.pendingElicitation).not.toBeNull()

    session.resolveElicitation({ name: "Alice" })

    expect(session.pendingElicitation).toBeNull()
    await expect(resultPromise).resolves.toEqual({
      action: "accept",
      content: { name: "Alice" },
    })
  })

  it("3. cancelElicitation('decline') resolves decline outcome, resets pendingElicitation", async () => {
    const resultPromise = capturedOnCreateElicitation?.(elicitationParams())
    session.cancelElicitation("decline")

    expect(session.pendingElicitation).toBeNull()
    await expect(resultPromise).resolves.toEqual({ action: "decline" })
  })

  it("4. cancelElicitation('cancel') resolves cancel outcome, resets pendingElicitation", async () => {
    const resultPromise = capturedOnCreateElicitation?.(elicitationParams())
    session.cancelElicitation("cancel")

    expect(session.pendingElicitation).toBeNull()
    await expect(resultPromise).resolves.toEqual({ action: "cancel" })
  })

  it("5. second request while pending → first resolves cancel, second becomes pending", async () => {
    const first = capturedOnCreateElicitation?.(elicitationParams("first?"))
    const secondParams = elicitationParams("second?")
    const second = capturedOnCreateElicitation?.(secondParams)

    await expect(first).resolves.toEqual({ action: "cancel" })
    expect(session.pendingElicitation?.params).toEqual(secondParams)

    session.resolveElicitation({ name: "Bob" })
    await expect(second).resolves.toEqual({ action: "accept", content: { name: "Bob" } })
  })

  it("6. detach() באמצע pending → נפתר cancel, אין תקיעה (DoD#5)", async () => {
    const resultPromise = capturedOnCreateElicitation?.(elicitationParams())
    expect(session.pendingElicitation).not.toBeNull()

    session.detach()

    expect(session.pendingElicitation).toBeNull()
    await expect(resultPromise).resolves.toEqual({ action: "cancel" })
  })

  it("7. leaveRunning() באמצע pending → נפתר cancel (גם דרך #cleanup)", async () => {
    const resultPromise = capturedOnCreateElicitation?.(elicitationParams())
    expect(session.pendingElicitation).not.toBeNull()

    session.leaveRunning()

    expect(session.pendingElicitation).toBeNull()
    await expect(resultPromise).resolves.toEqual({ action: "cancel" })
  })

  it("8. cancelTurn() באמצע pending → נפתר cancel (נתיב עצמאי, לא #cleanup)", async () => {
    session.turnState = "waiting"

    const resultPromise = capturedOnCreateElicitation?.(elicitationParams())
    expect(session.pendingElicitation).not.toBeNull()

    await session.cancelTurn()

    expect(session.pendingElicitation).toBeNull()
    await expect(resultPromise).resolves.toEqual({ action: "cancel" })
  })

  it("9. #doReconnect עם #transport חי → pending נפתר cancel לפני warm/cold", async () => {
    const resultPromise = capturedOnCreateElicitation?.(elicitationParams())
    expect(session.pendingElicitation).not.toBeNull()

    const closeAndWaitSpy = vi.fn().mockResolvedValue(undefined)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._setTransportForTest({ closeAndWait: closeAndWaitSpy })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._mockFindReusableAgentForTest(null)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._mockColdReconnectForTest(new Error("cold-blocked-for-test"))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (session as any)._doReconnectForTest().catch(() => {})

    expect(closeAndWaitSpy).toHaveBeenCalledOnce()
    expect(session.pendingElicitation).toBeNull()
    await expect(resultPromise).resolves.toEqual({ action: "cancel" })
  })
})
