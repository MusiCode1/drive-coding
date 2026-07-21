/**
 * agent-session.session-info.test.svelte.ts — TDD עבור handler של session_info_update
 * (slice-session-titles, Commit 0).
 *
 * מראה מדויק של agent-session.context-usage.test.svelte.ts.
 *
 * מכסה (brief §4 / §5 DoD 3):
 *   (א) title: string → sessionTitle נקבע
 *   (ב) title: null → sessionTitle נוקה ("")
 *   (ג) title: undefined (או שדה חסר) → sessionTitle נשמר (keep-on-undefined)
 *
 * Testing: TDD (red→green)
 * דפוס: captured-listener + inject() (כמו agent-session.context-usage.test.svelte.ts)
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
    sessionId: "s-session-info-test",
    configOptions: [],
    models: null,
    modes: null,
  }),
  loadSession: vi.fn().mockResolvedValue({ sessionId: "s-session-info-test" }),
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
  createAgent: vi.fn().mockResolvedValue({ agentId: "agent-session-info-test" }),
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
    sessionId: "s-session-info-test",
    configOptions: [],
    models: null,
    modes: null,
  })
})

// ─── Tests — Commit 0: session_info_update ─────────────────────────────────────

describe("AgentSession — session_info_update handler", () => {
  it("קובע sessionTitle כש-title הוא string", async () => {
    const session = await buildConnectedSession()

    inject({ sessionUpdate: "session_info_update", title: "Fix auth bug" })

    expect(session.sessionTitle).toBe("Fix auth bug")
  })

  it("מנקה sessionTitle ל-'' כש-title הוא null", async () => {
    const session = await buildConnectedSession()

    inject({ sessionUpdate: "session_info_update", title: "Fix auth bug" })
    expect(session.sessionTitle).toBe("Fix auth bug")

    inject({ sessionUpdate: "session_info_update", title: null })

    expect(session.sessionTitle).toBe("")
  })

  it("שומר sessionTitle כש-title הוא undefined (keep-on-undefined)", async () => {
    const session = await buildConnectedSession()

    inject({ sessionUpdate: "session_info_update", title: "Fix auth bug" })
    expect(session.sessionTitle).toBe("Fix auth bug")

    // update בלי title בכלל (שדה חסר) — לא אמור למחוק את הכותרת הקודמת
    inject({ sessionUpdate: "session_info_update" })

    expect(session.sessionTitle).toBe("Fix auth bug")
  })
})
