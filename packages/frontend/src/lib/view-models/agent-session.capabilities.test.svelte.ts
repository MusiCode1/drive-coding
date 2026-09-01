/**
 * agent-session.capabilities.test.svelte.ts — integration tests
 * לcapability ingestion ו-gating (slice FE-normalization, Phase 1).
 *
 * דפוס: agent-session.test.ts (מוק createAcpClient, לוכד callbacks).
 *
 * Tests:
 *   1. vm.capabilities == null לפני חיבור
 *   2. vm.supports מחזיר all-false לפני חיבור
 *   3. אחרי attach: _drive/capabilities extNotification → vm.capabilities נטען
 *   4. vm.supports.thinkingTokens מחזיר true אחרי extNotification עם thinkingTokens:true
 *   5. vm.supports.thinkingTokens מחזיר false אחרי extNotification עם thinkingTokens:false
 *   6. cleanup (detach) מנקה #capabilities → vm.capabilities==null שוב
 */

import type { AcpClient } from "@drive-coding/provider/client"
import type { NormalizedCapabilities } from "@drive-coding/provider/types"
import { beforeEach, describe, expect, it, vi } from "vitest"

// ─── Module-level mocks ───────────────────────────────────────────────────────

/** onExtNotification callback captured from createAcpClient call */
let capturedExtNotification: ((method: string, params: Record<string, unknown>) => void) | null =
  null

const mockClient: AcpClient = {
  conn: {} as AcpClient["conn"],
  capabilities: {} as AcpClient["capabilities"],
  newSession: vi.fn().mockResolvedValue({ sessionId: "session-caps-test" }),
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
        callbacks: {
          onUpdate: unknown
          onExtNotification?: (m: string, p: Record<string, unknown>) => void
        },
      ) => {
        // תמיכה בשתי צורות: function ישנה + object חדש
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
  createAgent: vi.fn().mockResolvedValue({ agentId: "agent-caps-test" }),
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  notifySessionAttached: vi.fn().mockResolvedValue(undefined),
  listAgents: vi.fn().mockResolvedValue([]),
}))

vi.mock("$lib/adapters/sessions", () => ({
  normalizeSessionInfo: vi.fn((x: unknown) => x),
}))

// ExtClient facade mock — מוק כדי שלא תלוי ב-extMethod real implementation
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
    systemPrompt: "unsupported",
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

describe("AgentSession — capabilities ingestion (FE-normalization)", () => {
  let session: AgentSession

  beforeEach(() => {
    capturedExtNotification = null
    ;(mockClient.newSession as ReturnType<typeof vi.fn>).mockClear()
    session = new AgentSession()
  })

  it("vm.capabilities is null before attach", () => {
    expect(session.capabilities).toBeNull()
  })

  it("vm.supports returns all-false before attach", () => {
    const s = session.supports
    expect(s.thinkingTokens).toBe(false)
    expect(s.mcp).toBe(false)
    expect(s.configOptions).toBe(false)
  })

  it("vm.capabilities is loaded from _drive/capabilities extNotification after attach", async () => {
    await session.attach({ cwd: "/some/cwd", cliKind: "claude" })
    expect(capturedExtNotification).not.toBeNull()

    simulateCaps({ thinkingTokens: true, mcp: false })

    expect(session.capabilities).not.toBeNull()
    expect(session.capabilities?.thinkingTokens).toBe(true)
  })

  it("vm.supports.thinkingTokens is true after _drive/capabilities with thinkingTokens:true", async () => {
    await session.attach({ cwd: "/some/cwd", cliKind: "claude" })
    simulateCaps({ thinkingTokens: true })

    expect(session.supports.thinkingTokens).toBe(true)
  })

  it("vm.supports.thinkingTokens is false after _drive/capabilities with thinkingTokens:false", async () => {
    await session.attach({ cwd: "/some/cwd", cliKind: "claude" })
    simulateCaps({ thinkingTokens: false })

    expect(session.supports.thinkingTokens).toBe(false)
  })

  it("detach clears #capabilities → vm.capabilities == null", async () => {
    await session.attach({ cwd: "/some/cwd", cliKind: "claude" })
    simulateCaps({ thinkingTokens: true })
    expect(session.capabilities).not.toBeNull()

    session.detach()

    expect(session.capabilities).toBeNull()
  })

  // ─── slice reattach-state-sync: supportsImageInput from normalized caps ───
  // mockClient.capabilities === {} (raw empty) mirrors warm reattach (ATTACHED_CAPS_FALLBACK).
  it("supportsImageInput becomes true from normalized _drive/capabilities even when raw client caps are empty (warm reattach)", async () => {
    await session.attach({ cwd: "/some/cwd", cliKind: "codex" })
    // raw #client.capabilities.promptCapabilities is undefined (empty mock) → false before caps arrive
    expect(session.supportsImageInput).toBe(false)

    simulateCaps({ image: true })

    // normalized image survives reattach → gate opens despite empty raw caps
    expect(session.supportsImageInput).toBe(true)
  })

  it("supportsImageInput stays false when normalized image is false", async () => {
    await session.attach({ cwd: "/some/cwd", cliKind: "codex" })
    simulateCaps({ image: false })

    expect(session.supportsImageInput).toBe(false)
  })

  it("counts _claude/sdkMessage ext notifications for the raw SDK spike", async () => {
    await session.attach({ cwd: "/some/cwd", cliKind: "claude" })
    expect(session.claudeRawSdkMessageCount).toBe(0)

    capturedExtNotification?.("_claude/sdkMessage", {
      message: { type: "system", subtype: "task_started" },
    })
    capturedExtNotification?.("_claude/sdkMessage", {
      message: { type: "assistant", parent_tool_use_id: "toolu_123" },
    })

    expect(session.claudeRawSdkMessageCount).toBe(2)
    expect(session.capabilities).toBeNull()
  })

  // ─── slice systemprompt-capability — DoD #9: שלושת המצבים ───
  // ⚠️ הטסט הקודם רינדר רכיב-fixture שהעתיק את התנאי ידנית, ולכן עבר גם כשקוד
  // הייצור היה שבור (ממצא כלב, בדיקת-מוטציה). כאן נבדק ה-getter של הייצור עצמו.

  it("showsSystemPromptWarning is false while capabilities are still unknown", async () => {
    await session.attach({ cwd: "/some/cwd", cliKind: "claude" })

    expect(session.capabilities).toBeNull()
    expect(session.showsSystemPromptWarning).toBe(false)
  })

  it("showsSystemPromptWarning is true when the provider does not support it", async () => {
    await session.attach({ cwd: "/some/cwd", cliKind: "opencode" })
    simulateCaps({ systemPrompt: "unsupported" })

    expect(session.showsSystemPromptWarning).toBe(true)
  })

  it("showsSystemPromptWarning is false when the provider supports it", async () => {
    await session.attach({ cwd: "/some/cwd", cliKind: "claude" })
    simulateCaps({ systemPrompt: "native" })

    expect(session.showsSystemPromptWarning).toBe(false)
  })

  it("showsSystemPromptWarning is false when the provider prepends charter", async () => {
    await session.attach({ cwd: "/some/cwd", cliKind: "opencode" })
    simulateCaps({ systemPrompt: "prepended" })

    expect(session.showsSystemPromptWarning).toBe(false)
  })
})
