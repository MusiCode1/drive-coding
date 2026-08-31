/**
 * agent-session.auth-methods.test.svelte.ts — integration tests ללכידת authMethods
 * (client.authMethods → session.authMethods $state), per slice auth-guidance §3 Commit 1.
 *
 * דפוס: agent-session.capabilities.test.svelte.ts (מוק createAcpClient עם mockClient).
 *
 * Tests:
 *   1. session.authMethods === [] לפני חיבור
 *   2. attach() עם client.authMethods לא-ריק → session.authMethods נלכד (roundtrip)
 *   3. attach() עם client.authMethods === [] (claude-like) → session.authMethods === []
 *   4. loadSession() לוכד authMethods באותו אופן
 *   5. attach שני (reconnect לCLI אחר) מנקה authMethods ישן לפני הלכידה החדשה
 */

import type { AcpClient } from "@drive-coding/provider/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

// ─── Module-level mocks ───────────────────────────────────────────────────────

/** authMethods שיוחזרו מ-createAcpClient המדומה בקריאה הבאה — נקבע פר-טסט. */
let mockAuthMethods: AcpClient["authMethods"] = []

function makeMockClient(): AcpClient {
  return {
    conn: {} as AcpClient["conn"],
    capabilities: {} as AcpClient["capabilities"],
    authMethods: mockAuthMethods,
    newSession: vi.fn().mockResolvedValue({ sessionId: "session-auth-test" }),
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
}

vi.mock("@drive-coding/provider/client", async (importActual) => {
  const actual = await importActual<typeof import("@drive-coding/provider/client")>()
  return {
    ...actual,
    createAcpClient: vi.fn(() => Promise.resolve(makeMockClient())),
  }
})

vi.mock("@drive-coding/acp-wire", () => ({
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
  createAgent: vi.fn().mockResolvedValue({ agentId: "agent-auth-test" }),
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AgentSession — authMethods capture (slice auth-guidance)", () => {
  let session: AgentSession

  beforeEach(() => {
    mockAuthMethods = []
    session = new AgentSession()
  })

  it("1. session.authMethods === [] before attach", () => {
    expect(session.authMethods).toEqual([])
  })

  it("2. attach() with non-empty client.authMethods → session.authMethods captures them (gemini-like)", async () => {
    mockAuthMethods = [
      { id: "oauth-personal", name: "Log in with Google" },
      {
        id: "gemini-api-key",
        name: "Gemini API Key",
        type: "env_var",
        vars: [{ name: "GEMINI_API_KEY" }],
      },
    ] as AcpClient["authMethods"]

    await session.attach({ cwd: "/some/cwd", cliKind: "gemini" })

    expect(session.authMethods).toEqual(mockAuthMethods)
  })

  it("3. attach() with empty client.authMethods (claude-like) → session.authMethods === []", async () => {
    mockAuthMethods = []

    await session.attach({ cwd: "/some/cwd", cliKind: "claude" })

    expect(session.authMethods).toEqual([])
  })

  it("4. loadSession() captures authMethods the same way", async () => {
    mockAuthMethods = [
      { id: "opencode-login", name: "opencode login", type: "terminal" },
    ] as AcpClient["authMethods"]

    await session.loadSession({ sessionId: "s1", cwd: "/some/cwd", cliKind: "opencode" })

    expect(session.authMethods).toEqual(mockAuthMethods)
  })

  it("5. a second attach() clears the previous authMethods before capturing the new ones", async () => {
    mockAuthMethods = [{ id: "cursor_login", name: "Cursor" }] as AcpClient["authMethods"]
    await session.attach({ cwd: "/some/cwd", cliKind: "gemini" })
    expect(session.authMethods).toEqual(mockAuthMethods)

    session.detach()
    mockAuthMethods = []
    await session.attach({ cwd: "/some/cwd", cliKind: "claude" })

    expect(session.authMethods).toEqual([])
  })
})

// ─── prompt catch: formatAcpError (claude "Authentication required", not raw "Internal error") ──

describe("AgentSession.sendPrompt — formatAcpError on the catch path (slice auth-guidance)", () => {
  it("6. prompt rejecting with a JSON-RPC-shaped error surfaces data.details, not the generic message", async () => {
    mockAuthMethods = []
    const session = new AgentSession()
    await session.attach({ cwd: "/some/cwd", cliKind: "claude" })

    const { createAcpClient } = await import("@drive-coding/provider/client")
    const mockClient = await (vi.mocked(createAcpClient).mock.results[
      vi.mocked(createAcpClient).mock.results.length - 1
    ]?.value as Promise<AcpClient>)
    ;(mockClient.prompt as ReturnType<typeof vi.fn>).mockRejectedValueOnce({
      message: "Internal error",
      data: { details: "Authentication required" },
    })

    await session.sendPrompt("hello")

    expect(session.error).toBe("prompt failed: Authentication required")
  })
})
