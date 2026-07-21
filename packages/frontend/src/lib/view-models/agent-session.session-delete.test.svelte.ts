/**
 * agent-session.session-delete.test.svelte.ts — integration tests ל-deleteSession + gate
 * (slice session-delete, Commit 1).
 *
 * דפוס: agent-session.capabilities.test.svelte.ts (מוק createAcpClient, לוכד callbacks,
 * מוטציה על mockClient.capabilities לפני attach — raw ACP caps, NOT NormalizedCapabilities).
 *
 * Tests:
 *   1. supportsSessionDelete === false לפני attach (#client===null)
 *   2. supportsSessionDelete === true אחרי attach כש-raw caps כוללים sessionCapabilities.delete
 *   3. supportsSessionDelete === false אחרי attach כש-raw caps לא כוללים sessionCapabilities.delete
 *      (warm-reattach fallback — ATTACHED_CAPS_FALLBACK ריק, אותה סמנטיקה)
 *   4. deleteSession(id) קורא ל-#client.deleteSession + מסיר מ-vm.sessions
 *   5. deleteSession על הסשן הפעיל → detach (status→idle, sessions→[])
 *   6. deleteSession על סשן שאינו פעיל → נשאר connected, שאר sessions נשארים
 *   7. deleteSession -32601 → מטופל בעדינות (לא נזרק, sessionsError לא משתנה)
 *   8. deleteSession no-op אם #client===null (לפני attach)
 */

import type { AcpClient } from "@drive-coding/provider/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

// ─── Module-level mocks ───────────────────────────────────────────────────────

const mockClient: AcpClient = {
  conn: {} as AcpClient["conn"],
  capabilities: {} as AcpClient["capabilities"],
  newSession: vi.fn().mockResolvedValue({ sessionId: "session-delete-test" }),
  loadSession: vi.fn().mockResolvedValue({}),
  listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
  deleteSession: vi.fn().mockResolvedValue(undefined),
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
    createAcpClient: vi.fn(() => Promise.resolve(mockClient)),
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
  createAgent: vi.fn().mockResolvedValue({ agentId: "agent-delete-test" }),
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  notifySessionAttached: vi.fn().mockResolvedValue(undefined),
  listAgents: vi.fn().mockResolvedValue([]),
}))

vi.mock("$lib/adapters/sessions", () => ({
  normalizeSessionInfo: vi.fn((x: unknown) => x),
}))

vi.mock("$lib/adapters/ext", () => ({
  createExtClient: vi.fn(() => ({
    setThinkingTokens: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.stubGlobal("location", { protocol: "http:", host: "localhost:5173", search: "" })
vi.stubGlobal("crypto", { randomUUID: () => "test-uuid" })

// ─── Import after mocks ───────────────────────────────────────────────────────
import { AgentSession } from "./agent-session.svelte"

describe("AgentSession — supportsSessionDelete (raw caps gate)", () => {
  let session: AgentSession

  beforeEach(() => {
    ;(mockClient.deleteSession as ReturnType<typeof vi.fn>).mockClear()
    mockClient.capabilities = {} as AcpClient["capabilities"]
    session = new AgentSession()
  })

  it("is false before attach (#client===null)", () => {
    expect(session.supportsSessionDelete).toBe(false)
  })

  it("is true after attach when raw caps include sessionCapabilities.delete", async () => {
    mockClient.capabilities = {
      sessionCapabilities: { delete: {} },
    } as unknown as AcpClient["capabilities"]

    await session.attach({ cwd: "/some/cwd", cliKind: "claude" })

    expect(session.supportsSessionDelete).toBe(true)
  })

  it("is false after attach when raw caps do not include sessionCapabilities.delete", async () => {
    mockClient.capabilities = {
      sessionCapabilities: { list: {} },
    } as unknown as AcpClient["capabilities"]

    await session.attach({ cwd: "/some/cwd", cliKind: "claude" })

    expect(session.supportsSessionDelete).toBe(false)
  })

  it("is false when raw caps are entirely empty (warm-reattach fallback semantics)", async () => {
    mockClient.capabilities = {} as AcpClient["capabilities"]

    await session.attach({ cwd: "/some/cwd", cliKind: "claude" })

    expect(session.supportsSessionDelete).toBe(false)
  })
})

describe("AgentSession — deleteSession", () => {
  let session: AgentSession

  beforeEach(async () => {
    ;(mockClient.deleteSession as ReturnType<typeof vi.fn>).mockClear()
    ;(mockClient.deleteSession as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    mockClient.capabilities = {
      sessionCapabilities: { delete: {} },
    } as unknown as AcpClient["capabilities"]
    session = new AgentSession()
    await session.attach({ cwd: "/some/cwd", cliKind: "claude" })
    // הסשן הפעיל אחרי attach הוא "session-delete-test" (mockClient.newSession).
    // הזרק עוד סשן ברשימה כדי לבדוק הסרה סלקטיבית (לא-פעיל).
    session.sessions = [
      { sessionId: "session-delete-test", cwd: "/some/cwd", title: "" },
      { sessionId: "other-session", cwd: "/some/cwd", title: "" },
    ] as unknown as typeof session.sessions
  })

  it("no-op if #client===null (before attach)", async () => {
    const fresh = new AgentSession()
    await fresh.deleteSession("whatever")
    expect(mockClient.deleteSession).not.toHaveBeenCalled()
  })

  it("calls #client.deleteSession(id), removes from vm.sessions, returns false (non-active)", async () => {
    const wasActive = await session.deleteSession("other-session")

    expect(mockClient.deleteSession).toHaveBeenCalledWith("other-session")
    expect(session.sessions.map((s) => s.sessionId)).toEqual(["session-delete-test"])
    // לא הפעיל → אין detach, נשאר connected, wasActive=false (הקומפוננטה לא מנווטת)
    expect(session.status).toBe("connected")
    expect(wasActive).toBe(false)
  })

  it("deleting the active session detaches (status→idle, sessions cleared) and returns true", async () => {
    const wasActive = await session.deleteSession("session-delete-test")

    expect(mockClient.deleteSession).toHaveBeenCalledWith("session-delete-test")
    expect(session.status).toBe("idle")
    expect(session.sessions).toEqual([])
    // wasActive=true → הקומפוננטה עושה goto("/") (calev NO-GO fix, DoD #7)
    expect(wasActive).toBe(true)
  })

  it("-32601 (method not found) is handled gently — not thrown, sessionsError untouched", async () => {
    ;(mockClient.deleteSession as ReturnType<typeof vi.fn>).mockRejectedValueOnce({ code: -32601 })

    await expect(session.deleteSession("other-session")).resolves.toBe(false)

    expect(session.sessionsError).toBeNull()
    // לא הוסר — הקריאה נכשלה
    expect(session.sessions.map((s) => s.sessionId)).toEqual([
      "session-delete-test",
      "other-session",
    ])
  })

  it("other errors set sessionsError (not thrown to UI)", async () => {
    ;(mockClient.deleteSession as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"))

    await expect(session.deleteSession("other-session")).resolves.toBe(false)

    expect(session.sessionsError).toBe("boom")
  })
})
