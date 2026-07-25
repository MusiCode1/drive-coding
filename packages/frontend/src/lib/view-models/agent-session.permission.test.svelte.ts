/**
 * agent-session.permission.test.svelte.ts — integration tests לתשתית בקשת-הרשאה חיה
 * (slice-permission-ui-basic Commit 2).
 *
 * דפוס: agent-session.capabilities.test.svelte.ts (מוק createAcpClient, לוכד callbacks).
 * הסיכון המרכזי (§4 Commit 2 / §6): Promise תלוי — teardown/reconnect חייבים לפתור
 * pendingPermission, אחרת turn נתקע. הטסטים כאן מכסים את כל נקודות ה-#client=null:
 * #cleanup (detach/leaveRunning), cancelTurn, ו-#doReconnect (reconnect path אחד לדוגמה —
 * שלושת ה-reconnect paths חולקים את אותו #resolvePendingPermission, ר' walkthrough).
 *
 * Tests:
 *   1. #onRequestPermission (דרך callback שנלכד) קובע pendingPermission עם params.
 *   2. resolvePermission(optionId) פותר את ה-Promise עם selected+optionId, מאפס pendingPermission.
 *   3. cancelPermission() פותר כ-cancelled, מאפס pendingPermission.
 *   4. בקשה שנייה בזמן pending → הראשונה נפתרת cancelled, השנייה הופכת pending (§5 DoD#8).
 *   5. bypass (claude, mode=bypassPermissions) → auto-allow, pendingPermission נשאר null (§5 DoD#6).
 *   6. detach() באמצע pending → נפתר cancelled, אין תקיעה (§5 DoD#5).
 *   7. leaveRunning() באמצע pending → נפתר cancelled (גם הוא דרך #cleanup).
 *   8. cancelTurn() באמצע pending → נפתר cancelled (נתיב עצמאי, לא #cleanup).
 *   9. reconnect: #doReconnect עם #transport חי → pending נפתר cancelled לפני warm/cold.
 */

import type { AcpClient } from "@drive-coding/provider/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

// ─── Module-level mocks ───────────────────────────────────────────────────────

type OnRequestPermission = (params: unknown) => Promise<unknown>

/** onRequestPermission callback captured from createAcpClient call */
let capturedOnRequestPermission: OnRequestPermission | null = null

const mockClient: AcpClient = {
  conn: {} as AcpClient["conn"],
  capabilities: {} as AcpClient["capabilities"],
  newSession: vi.fn().mockResolvedValue({ sessionId: "session-perm-test" }),
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
        callbacks: { onUpdate: unknown; onRequestPermission?: OnRequestPermission },
      ) => {
        if (typeof callbacks === "object" && callbacks !== null) {
          capturedOnRequestPermission = callbacks.onRequestPermission ?? null
        }
        return Promise.resolve(mockClient)
      },
    ),
  }
})

vi.mock("$lib/engines/ws-transport", () => ({
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
  createAgent: vi.fn().mockResolvedValue({ agentId: "agent-perm-test" }),
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

function permissionParams(options: { optionId: string; name: string; kind: string }[]) {
  return {
    sessionId: "session-perm-test",
    toolCall: { toolCallId: "t1", title: "Write file" },
    options,
  }
}

const OPTIONS = [
  { optionId: "reject-1", name: "Reject", kind: "reject_once" },
  { optionId: "allow-1", name: "Allow once", kind: "allow_once" },
]

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AgentSession — permission request round-trip (slice-permission-ui-basic Commit 2)", () => {
  let session: AgentSession

  beforeEach(async () => {
    capturedOnRequestPermission = null
    ;(mockClient.close as ReturnType<typeof vi.fn>).mockClear()
    session = new AgentSession()
    await session.attach({ cwd: "/some/cwd", cliKind: "claude" })
    expect(capturedOnRequestPermission).not.toBeNull()
  })

  it("1. #onRequestPermission sets pendingPermission with params", () => {
    void capturedOnRequestPermission?.(permissionParams(OPTIONS))
    expect(session.pendingPermission).not.toBeNull()
    expect(session.pendingPermission?.params).toEqual(permissionParams(OPTIONS))
  })

  it("2. resolvePermission(optionId) resolves selected outcome, resets pendingPermission", async () => {
    const resultPromise = capturedOnRequestPermission?.(permissionParams(OPTIONS))
    expect(session.pendingPermission).not.toBeNull()

    session.resolvePermission("allow-1")

    expect(session.pendingPermission).toBeNull()
    await expect(resultPromise).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "allow-1" },
    })
  })

  it("3. cancelPermission() resolves cancelled outcome, resets pendingPermission", async () => {
    const resultPromise = capturedOnRequestPermission?.(permissionParams(OPTIONS))
    session.cancelPermission()

    expect(session.pendingPermission).toBeNull()
    await expect(resultPromise).resolves.toEqual({ outcome: { outcome: "cancelled" } })
  })

  it("4. second request while pending → first resolves cancelled, second becomes pending (DoD#8)", async () => {
    const first = capturedOnRequestPermission?.(permissionParams(OPTIONS))
    const secondParams = permissionParams([
      { optionId: "allow-2", name: "Allow", kind: "allow_once" },
    ])
    const second = capturedOnRequestPermission?.(secondParams)

    await expect(first).resolves.toEqual({ outcome: { outcome: "cancelled" } })
    expect(session.pendingPermission?.params).toEqual(secondParams)

    session.resolvePermission("allow-2")
    await expect(second).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "allow-2" },
    })
  })

  it("5. bypass (claude, mode=bypassPermissions) → auto-allow, no pendingPermission block (DoD#6)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any).modes = {
      currentModeId: "bypassPermissions",
      availableModes: [{ id: "bypassPermissions", name: "Bypass" }],
    }
    expect(session.bypassActive).toBe(true)

    const result = await capturedOnRequestPermission?.(permissionParams(OPTIONS))

    expect(session.pendingPermission).toBeNull() // אין block — auto-allow הגן, לא נחשף UI
    expect(result).toEqual({ outcome: { outcome: "selected", optionId: "allow-1" } })
  })

  it("6. detach() באמצע pending → נפתר cancelled, אין תקיעה (DoD#5)", async () => {
    const resultPromise = capturedOnRequestPermission?.(permissionParams(OPTIONS))
    expect(session.pendingPermission).not.toBeNull()

    session.detach()

    expect(session.pendingPermission).toBeNull()
    await expect(resultPromise).resolves.toEqual({ outcome: { outcome: "cancelled" } })
  })

  it("7. leaveRunning() באמצע pending → נפתר cancelled (גם דרך #cleanup)", async () => {
    const resultPromise = capturedOnRequestPermission?.(permissionParams(OPTIONS))
    expect(session.pendingPermission).not.toBeNull()

    session.leaveRunning()

    expect(session.pendingPermission).toBeNull()
    await expect(resultPromise).resolves.toEqual({ outcome: { outcome: "cancelled" } })
  })

  it("8. cancelTurn() באמצע pending → נפתר cancelled (נתיב עצמאי, לא #cleanup)", async () => {
    // turnState אין לו test-setter ייעודי — נגדיר ישירות (public $state)
    session.turnState = "waiting"

    const resultPromise = capturedOnRequestPermission?.(permissionParams(OPTIONS))
    expect(session.pendingPermission).not.toBeNull()

    await session.cancelTurn()

    expect(session.pendingPermission).toBeNull()
    await expect(resultPromise).resolves.toEqual({ outcome: { outcome: "cancelled" } })
  })

  it("9. #doReconnect עם #transport חי → pending נפתר cancelled לפני warm/cold", async () => {
    const resultPromise = capturedOnRequestPermission?.(permissionParams(OPTIONS))
    expect(session.pendingPermission).not.toBeNull()

    const closeAndWaitSpy = vi.fn().mockResolvedValue(undefined)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._setTransportForTest({ closeAndWait: closeAndWaitSpy })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._mockFindReusableAgentForTest(null)
    // עוצר מוקדם אחרי ה-#client=null+resolve שאנחנו בודקים — אין צורך ב-WS אמיתי
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._mockColdReconnectForTest(new Error("cold-blocked-for-test"))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (session as any)._doReconnectForTest().catch(() => {}) // coldReconnect mock זורק בכוונה — לא רלוונטי לטסט

    expect(closeAndWaitSpy).toHaveBeenCalledOnce()
    expect(session.pendingPermission).toBeNull()
    await expect(resultPromise).resolves.toEqual({ outcome: { outcome: "cancelled" } })
  })
})
