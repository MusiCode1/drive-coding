/**
 * agent-session.crash-path.test.svelte.ts — integration test (Commit 3, slice surface-real-error).
 *
 * DoD#4: כשל handshake (JSON-RPC) מכוסה ע"י format-acp-error.test.ts +
 * agent-session.error-surface.test.svelte.ts (מסלול A+B). כאן: מסלול C —
 * child crash — #handleUnexpectedClose (הפך ל-async ב-Commit 3) מנסה best-effort
 * getAgent(agentId) לפני נפילה ל-"WS closed", ומציג crashReason אם status="crashed".
 *
 * pageHidden=true (כמו agent-session.error-surface.test.svelte.ts) — עוקף
 * #scheduleReconnect כדי לא להצית async מודלף/network אמיתי דרך #runReconnectLoop.
 */

import { beforeEach, describe, expect, test, vi } from "vitest"

const getAgentMock = vi.fn()

vi.mock("../adapters/agents-api", () => ({
  createAgent: vi.fn(),
  deleteAgent: vi.fn(),
  notifySessionAttached: vi.fn(),
  listAgents: vi.fn(),
  getAgent: (...args: unknown[]) => getAgentMock(...args),
}))

vi.mock("../adapters/sessions", () => ({
  normalizeSessionInfo: vi.fn((x: unknown) => x),
}))

import { AgentSession } from "./agent-session.svelte"

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.stubGlobal("document", { hidden: true, addEventListener: vi.fn() })
  getAgentMock.mockReset()
})

describe("AgentSession — crash-path ב-#handleUnexpectedClose (DoD#4, Commit 3)", () => {
  test("agentId מוגדר + getAgent מחזיר status=crashed+crashReason → מוצג crashReason", async () => {
    const session = new AgentSession()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any).agentId = "agent-1"
    getAgentMock.mockResolvedValue({
      agent: { cwd: "/tmp", status: "crashed", crashReason: "ENOENT: claude binary not found" },
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (session as any)._handleUnexpectedCloseForTest(1006, "abnormal closure")

    expect(session.error).toBe("ENOENT: claude binary not found")
    expect(getAgentMock).toHaveBeenCalledWith("agent-1")
  })

  test("agentId מוגדר + getAgent מחזיר status רגיל (לא crashed) → נופל ל-WS closed", async () => {
    const session = new AgentSession()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any).agentId = "agent-2"
    getAgentMock.mockResolvedValue({ agent: { cwd: "/tmp", status: "ready" } })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (session as any)._handleUnexpectedCloseForTest(1006, "abnormal closure")

    expect(session.error).toBe("WS closed (1006): abnormal closure")
  })

  test("agentId מוגדר + getAgent זורק (404/רשת) → best-effort נכשל, נופל ל-WS closed", async () => {
    const session = new AgentSession()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any).agentId = "agent-3"
    getAgentMock.mockRejectedValue(new Error("getAgent failed: 404"))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (session as any)._handleUnexpectedCloseForTest(1005, "")

    expect(session.error).toBe("WS closed (1005): no reason")
  })

  test("אין agentId (null) → getAgent לא נקרא כלל, נופל מיד ל-WS closed", async () => {
    const session = new AgentSession()
    expect(session.agentId).toBeNull()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (session as any)._handleUnexpectedCloseForTest(1005, "no reason")

    expect(session.error).toBe("WS closed (1005): no reason")
    expect(getAgentMock).not.toHaveBeenCalled()
  })

  test("anti-clobber (Commit 1) שורד גם עם המסלול ה-async: getAgent לא נקרא אם כבר יש error", async () => {
    const session = new AgentSession()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any).agentId = "agent-4"
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any)._setStatusForTest("error")
    session.error = "specific error from attach catch"

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (session as any)._handleUnexpectedCloseForTest(1006, "abnormal closure")

    expect(session.error).toBe("specific error from attach catch")
    expect(getAgentMock).not.toHaveBeenCalled()
  })

  test("crashed אבל בלי crashReason (שדה אופציונלי חסר) → נופל ל-WS closed", async () => {
    const session = new AgentSession()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(session as any).agentId = "agent-5"
    getAgentMock.mockResolvedValue({ agent: { cwd: "/tmp", status: "crashed" } })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (session as any)._handleUnexpectedCloseForTest(1006, "abnormal closure")

    expect(session.error).toBe("WS closed (1006): abnormal closure")
  })
})
