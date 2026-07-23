/**
 * agent-session.fork-session.test.svelte.ts — integration tests ל-forkSession + fork gate
 * (slice session-fork-ui, Commit 1).
 *
 * דפוס: agent-session.capabilities.test.svelte.ts (gating דרך _drive/capabilities extNotification)
 * + agent-session.session-delete.test.svelte.ts (מוק createAcpClient, warm action על #client חי).
 *
 * Tests:
 *   1. session.supports.fork === false לפני attach
 *   2. session.supports.fork === true אחרי _drive/capabilities עם fork:true
 *   3. session.supports.fork === false אחרי _drive/capabilities בלי fork (undefined — claude רק ל-Commit0)
 *   4. forkSession() קורא ל-#client.forkSession({cwd, sessionId: הנוכחי})
 *   5. forkSession() מעביר את vm.sessionId ל-id החדש מהתגובה (לא הישן)
 *   6. forkSession() קורא ל-notifySessionAttached(agentId, newId, {replace:true})
 *   7. forkSession() נשאר status="connected" אחרי הצלחה
 *   8. forkSession() no-op אם #client===null (לפני attach)
 *   9. forkSession() שגיאה → status="error" + error מוגדר, #client נשאר חי
 */

import type { AcpClient } from "@drive-coding/provider/client"
import type { NormalizedCapabilities } from "@drive-coding/provider/types"
import { beforeEach, describe, expect, it, vi } from "vitest"

// ─── Module-level mocks ───────────────────────────────────────────────────────

let capturedExtNotification: ((method: string, params: Record<string, unknown>) => void) | null =
  null

const mockClient: AcpClient = {
  conn: {} as AcpClient["conn"],
  capabilities: {} as AcpClient["capabilities"],
  newSession: vi.fn().mockResolvedValue({ sessionId: "session-fork-test" }),
  loadSession: vi.fn().mockResolvedValue({}),
  forkSession: vi.fn().mockResolvedValue({ sessionId: "session-fork-test-NEW" }),
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
        callbacks: {
          onUpdate: unknown
          onExtNotification?: (m: string, p: Record<string, unknown>) => void
        },
      ) => {
        if (
          typeof callbacks === "object" &&
          callbacks !== null &&
          "onExtNotification" in callbacks
        ) {
          capturedExtNotification = callbacks.onExtNotification ?? null
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
    }
  }),
}))

const notifySessionAttached = vi.fn().mockResolvedValue(undefined)

vi.mock("$lib/adapters/agents-api", () => ({
  createAgent: vi.fn().mockResolvedValue({ agentId: "agent-fork-test" }),
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  notifySessionAttached: (...args: unknown[]) => notifySessionAttached(...args),
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCapabilities(overrides: Partial<NormalizedCapabilities> = {}): NormalizedCapabilities {
  return {
    mcp: false,
    compact: false,
    commands: false,
    usage: false,
    configOptions: false,
    rename: false,
    thinkingTokens: false,
    image: false,
    ...overrides,
  }
}

function simulateCaps(caps: Partial<NormalizedCapabilities>): void {
  capturedExtNotification?.(
    "_drive/capabilities",
    makeCapabilities(caps) as unknown as Record<string, unknown>,
  )
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AgentSession — supports.fork gate", () => {
  let session: AgentSession

  beforeEach(() => {
    capturedExtNotification = null
    session = new AgentSession()
  })

  it("is falsy before attach (fork is optional — fallback object omits it)", () => {
    expect(session.supports.fork).toBeFalsy()
  })

  it("is true after _drive/capabilities with fork:true", async () => {
    await session.attach({ cwd: "/some/cwd", cliKind: "claude" })
    simulateCaps({ fork: true })

    expect(session.supports.fork).toBe(true)
  })

  it("is falsy after _drive/capabilities without fork (other providers)", async () => {
    await session.attach({ cwd: "/some/cwd", cliKind: "codex" })
    simulateCaps({}) // fork omitted — עקבי עם mapClaudeCapabilities-only design

    expect(session.supports.fork).toBeFalsy()
  })
})

describe("AgentSession — forkSession", () => {
  let session: AgentSession

  beforeEach(async () => {
    ;(mockClient.forkSession as ReturnType<typeof vi.fn>).mockClear()
    ;(mockClient.forkSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessionId: "session-fork-test-NEW",
    })
    notifySessionAttached.mockClear()
    session = new AgentSession()
    await session.attach({ cwd: "/some/cwd", cliKind: "claude" })
    simulateCaps({ fork: true })
  })

  it("no-op if #client===null (before attach)", async () => {
    const fresh = new AgentSession()
    await fresh.forkSession()
    expect(mockClient.forkSession).not.toHaveBeenCalled()
  })

  it("calls #client.forkSession({cwd, sessionId: current}) and switches vm.sessionId to the NEW id", async () => {
    expect(session._getSessionIdForTest()).toBe("session-fork-test") // attach's newSession id (baseline)

    await session.forkSession()

    expect(mockClient.forkSession).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "/some/cwd", sessionId: "session-fork-test" }),
    )
    // ה-VM עבר ל-id החדש מהתגובה — לא נשאר על הישן (זו לא switchSession/loadSession)
    expect(session._getSessionIdForTest()).toBe("session-fork-test-NEW")
  })

  it("notifies the BE of the new session (replace:true) on the same agentId", async () => {
    await session.forkSession()

    expect(notifySessionAttached).toHaveBeenCalledWith("agent-fork-test", "session-fork-test-NEW", {
      replace: true,
    })
  })

  it("status stays 'connected' after a successful fork", async () => {
    await session.forkSession()

    expect(session.status).toBe("connected")
  })

  it("a rejected forkSession sets status='error' + error, keeps #client alive (no cleanup)", async () => {
    ;(mockClient.forkSession as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("fork boom"),
    )

    await session.forkSession()

    expect(session.status).toBe("error")
    expect(session.error).toContain("forkSession failed")
    // #client נשאר חי — sessionId המקורי לא נדרס (הפיצול נכשל, לא ה-session הקיים)
    expect(session._getSessionIdForTest()).toBe("session-fork-test")
  })
})
