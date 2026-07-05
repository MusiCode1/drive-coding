/**
 * agent-session.permission.test.svelte.ts — TDD עבור ה-state bridge של בקשות-הרשאה
 * (slice-permission-ui-client-shell, Commit 1).
 *
 * מכסה (§5 DoD):
 *   3. pendingPermission נוצר ונפתר דרך VM (beginPermissionForTestOrHarness + resolvePermission)
 *   4. requestId שגוי לא פותר state נוכחי
 *   5. cleanup/cancel (cancelTurn/detach/leaveRunning) סוגרים pending כ-cancelled
 *
 * client shell בלבד: אין כאן חיבור חי ל-ACP — beginPermissionForTestOrHarness מזריק
 * PermissionParams מקומית (ללא agent אמיתי), בדיוק כמו שה-harness/dev יעשה ב-Commit 3.
 *
 * דפוס: captured-listener + buildConnectedSession (כמו agent-session.turnstate.test.svelte.ts).
 *
 * Testing: tdd
 */

import type { SessionNotification } from "@agentclientprotocol/sdk"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PermissionParams } from "$lib/types/permission"

// ─── Module-level mocks ───────────────────────────────────────────────────────

let capturedListener: ((n: SessionNotification) => void) | null = null

const mockClient = {
  prompt: vi.fn().mockResolvedValue(undefined),
  cancel: vi.fn().mockResolvedValue(undefined),
  newSession: vi.fn().mockResolvedValue({ sessionId: "s-perm-test" }),
  loadSession: vi.fn().mockResolvedValue({ sessionId: "s-perm-test" }),
  listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
  setSessionConfigOption: vi.fn(),
  setSessionModel: vi.fn(),
  setSessionMode: vi.fn(),
  close: vi.fn(),
}

vi.mock("@drive-coding/provider/client", async (importActual) => {
  const actual = await importActual<typeof import("@drive-coding/provider/client")>()
  return {
    ...actual,
    createAcpClient: vi
      .fn()
      .mockImplementation(
        (
          _transport: unknown,
          callbackOrCallbacks:
            | ((n: SessionNotification) => void)
            | { onUpdate: (n: SessionNotification) => void; onExtNotification?: unknown },
        ) => {
          capturedListener =
            typeof callbackOrCallbacks === "function"
              ? callbackOrCallbacks
              : callbackOrCallbacks.onUpdate
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

vi.stubGlobal("location", {
  protocol: "http:",
  host: "localhost:5173",
  search: "",
})

let uuidCounter = 0
vi.stubGlobal("crypto", {
  randomUUID: vi.fn(() => `test-uuid-${++uuidCounter}`),
})

// ─── Import after mocks ───────────────────────────────────────────────────────

import { AgentSession } from "./agent-session.svelte"

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function buildConnectedSession(): Promise<AgentSession> {
  const session = new AgentSession()
  await session.attach({ cwd: "/tmp", cliKind: "claude" })
  if (session.status !== "connected") {
    throw new Error(`attach failed: status=${session.status} error=${session.error}`)
  }
  return session
}

/** הזרקת SessionNotification דרך ה-captured listener (כמו agent-session.turnstate.test.svelte.ts). */
function inject(update: Record<string, unknown>): void {
  if (!capturedListener) throw new Error("listener not captured — attach() not called?")
  capturedListener({ update } as unknown as SessionNotification)
}

function makePermissionParams(
  options: { optionId: string; name: string; kind: string }[] = [
    { optionId: "opt-allow", name: "Allow", kind: "allow_once" },
    { optionId: "opt-reject", name: "Reject", kind: "reject_once" },
  ],
): PermissionParams {
  return {
    sessionId: "s-perm-test",
    toolCall: { toolCallId: "tc-1" },
    options,
  } as unknown as PermissionParams
}

// ─── beforeEach ───────────────────────────────────────────────────────────────

beforeEach(() => {
  uuidCounter = 0
  capturedListener = null
  mockClient.newSession.mockResolvedValue({ sessionId: "s-perm-test" })
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AgentSession — permission state bridge", () => {
  it("pendingPermission מתחיל null", async () => {
    const session = await buildConnectedSession()
    expect(session.pendingPermission).toBeNull()
  })

  it("beginPermissionForTestOrHarness יוצר pendingPermission עם options ממופים ו-status=pending", async () => {
    const session = await buildConnectedSession()
    const params = makePermissionParams()

    session.beginPermissionForTestOrHarness(params)

    expect(session.pendingPermission).not.toBeNull()
    expect(session.pendingPermission?.status).toBe("pending")
    expect(session.pendingPermission?.raw).toBe(params)
    expect(session.pendingPermission?.options).toEqual([
      { optionId: "opt-allow", name: "Allow", kind: "allow_once" },
      { optionId: "opt-reject", name: "Reject", kind: "reject_once" },
    ])
  })

  it("resolvePermission עם requestId נכון פותר את הבקשה ומסמן selectedOptionId", async () => {
    const session = await buildConnectedSession()
    session.beginPermissionForTestOrHarness(makePermissionParams())
    const id = session.pendingPermission!.id

    session.resolvePermission(id, "opt-allow")

    expect(session.pendingPermission?.status).toBe("resolved")
    expect(session.pendingPermission?.selectedOptionId).toBe("opt-allow")
    // state נשאר מוצג (disabled) — לא נמחק
    expect(session.pendingPermission).not.toBeNull()
  })

  it("resolvePermission עם requestId שגוי לא פותר את הבקשה הנוכחית", async () => {
    const session = await buildConnectedSession()
    session.beginPermissionForTestOrHarness(makePermissionParams())

    session.resolvePermission("wrong-id", "opt-allow")

    expect(session.pendingPermission?.status).toBe("pending")
    expect(session.pendingPermission?.selectedOptionId).toBeUndefined()
  })

  it("cancelPermission עם requestId נכון מסמן cancelled", async () => {
    const session = await buildConnectedSession()
    session.beginPermissionForTestOrHarness(makePermissionParams())
    const id = session.pendingPermission!.id

    session.cancelPermission(id)

    expect(session.pendingPermission?.status).toBe("cancelled")
  })

  it("cancelPermission עם requestId שגוי לא נוגע ב-pending הנוכחי", async () => {
    const session = await buildConnectedSession()
    session.beginPermissionForTestOrHarness(makePermissionParams())

    session.cancelPermission("wrong-id")

    expect(session.pendingPermission?.status).toBe("pending")
  })

  it("בקשה חדשה בזמן שיש pending ישנה: הישנה נדרסת, וה-pendingPermission הנוכחי הוא החדש", async () => {
    const session = await buildConnectedSession()
    session.beginPermissionForTestOrHarness(makePermissionParams())
    const oldId = session.pendingPermission!.id

    const newParams = makePermissionParams([{ optionId: "opt-x", name: "X", kind: "allow_always" }])
    session.beginPermissionForTestOrHarness(newParams)

    expect(session.pendingPermission?.id).not.toBe(oldId)
    expect(session.pendingPermission?.raw).toBe(newParams)
    expect(session.pendingPermission?.status).toBe("pending")

    // ה-id הישן כבר לא רלוונטי — לא פותר את הבקשה הנוכחית
    session.resolvePermission(oldId, "opt-x")
    expect(session.pendingPermission?.status).toBe("pending")
  })

  it("cancelTurn סוגר pending פתוחה כ-cancelled", async () => {
    const session = await buildConnectedSession()
    session.beginPermissionForTestOrHarness(makePermissionParams())
    // turnState חייב להיות שונה מ-idle כדי ש-cancelTurn לא יחזור מוקדם (guard) —
    // מזריקים agent_message_chunk כמו ב-agent-session.turnstate.test.svelte.ts.
    inject({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "hi" },
      messageId: "m1",
    })
    expect(session.turnState).toBe("responding")

    await session.cancelTurn()

    expect(session.pendingPermission?.status).toBe("cancelled")
  })

  it("detach סוגר pending פתוחה כ-cancelled (לא מוחק)", async () => {
    const session = await buildConnectedSession()
    session.beginPermissionForTestOrHarness(makePermissionParams())

    session.detach()

    expect(session.pendingPermission).not.toBeNull()
    expect(session.pendingPermission?.status).toBe("cancelled")
  })

  it("leaveRunning סוגר pending פתוחה כ-cancelled (לא מוחק)", async () => {
    const session = await buildConnectedSession()
    session.beginPermissionForTestOrHarness(makePermissionParams())

    session.leaveRunning()

    expect(session.pendingPermission).not.toBeNull()
    expect(session.pendingPermission?.status).toBe("cancelled")
  })

  it("resolve/cancel על pending שכבר resolved/cancelled לא זורק (idempotent no-op)", async () => {
    const session = await buildConnectedSession()
    session.beginPermissionForTestOrHarness(makePermissionParams())
    const id = session.pendingPermission!.id
    session.resolvePermission(id, "opt-allow")

    expect(() => session.cancelPermission(id)).not.toThrow()
    // כבר resolved — cancel לא דורס resolved בהכרח, אבל לא זורק ולא נמחק
    expect(session.pendingPermission).not.toBeNull()
  })
})
