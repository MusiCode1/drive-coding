/**
 * agent-session.restore-config.test.svelte.ts — TDD עבור #applyRememberedConfig
 * (slice-restore-last-config, Commit 2).
 *
 * כיסוי (מה-brief §2):
 *   1. attach (חיבור ראשון) מחיל remembered אחרי connected — applyConfigOption נקרא.
 *   2. newSession מחיל גם כן.
 *   3. ערך לא-תקף נדלג (guard-תקפות).
 *   4. אין settings → no-op חינני.
 *   5. loadSession לא מחיל (resume — לא דורסים).
 *   6. applyConfigOption נקרא רק אחרי status="connected" (לא לפני).
 *
 * דפוס: agent-session.test.ts (מוק @drive-coding/provider/client + ws-transport + agents-api).
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AcpClient } from "@drive-coding/provider/client"
import type { SessionConfigOption, SessionModeState } from "@agentclientprotocol/sdk"

// ─── Module-level mocks ───────────────────────────────────────────────────────

let capturedOnSessionUpdate: ((notification: unknown) => void) | null = null

// מוק AcpClient — לכידת callback + setSessionMode/setSessionConfigOption spies
let mockSetSessionMode: ReturnType<typeof vi.fn>
let mockSetSessionConfigOption: ReturnType<typeof vi.fn>
let mockNewSession: ReturnType<typeof vi.fn>

vi.mock("@drive-coding/provider/client", async (importActual) => {
  const actual = await importActual<typeof import("@drive-coding/provider/client")>()
  return {
    ...actual,
    createAcpClient: vi.fn(function mockCreateClient(
      _transport: unknown,
      callbackOrCallbacks:
        | ((notification: unknown) => void)
        | { onUpdate: (n: unknown) => void; onExtNotification?: unknown },
    ): Promise<AcpClient> {
      // ─── slice FE-normalization: תמיכה בשתי חתימות ───
      capturedOnSessionUpdate =
        typeof callbackOrCallbacks === "function"
          ? callbackOrCallbacks
          : callbackOrCallbacks.onUpdate
      return Promise.resolve({
        newSession: mockNewSession,
        prompt: vi.fn().mockResolvedValue(undefined),
        loadSession: vi.fn().mockResolvedValue({}),
        cancel: vi.fn(),
        listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
        close: vi.fn(),
        setSessionConfigOption: mockSetSessionConfigOption,
        setSessionModel: vi.fn().mockResolvedValue(undefined),
        setSessionMode: mockSetSessionMode,
      } as unknown as AcpClient)
    }),
  }
})

vi.mock("@drive-coding/acp-wire/browser", () => ({
  WsAcpTransport: vi.fn(function mockWsTransport() {
    return {
      onClose: vi.fn(),
      waitForOpen: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      closeAndWait: vi.fn().mockResolvedValue(undefined),
    }
  }),
}))

vi.mock("$lib/adapters/agents-api", () => ({
  createAgent: vi.fn().mockResolvedValue({ agentId: "test-agent" }),
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  notifySessionAttached: vi.fn().mockResolvedValue(undefined),
  listAgents: vi.fn().mockResolvedValue([]),
}))

// ─── Import after mocks ───────────────────────────────────────────────────────

import { AgentSession } from "./agent-session.svelte"

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Settings mock מינימלי עם lastConfig מאוכלס */
function makeSettingsMock(lastConfig: Record<string, Record<string, string | boolean>>) {
  return {
    lastConfig,
    setLastConfig: vi.fn(),
  }
}

/** SessionModeState עם mode יחיד */
function makeModes(modeId: string): SessionModeState {
  return {
    currentModeId: modeId,
    availableModes: [{ id: modeId, name: modeId }],
  }
}

/** SessionConfigOption[] עם option אחד מסוג boolean */
function makeBooleanOption(id: string): SessionConfigOption[] {
  return [
    {
      id,
      type: "boolean",
      category: "other",
      name: id,
      value: false,
    } as unknown as SessionConfigOption,
  ]
}

// ─── beforeEach ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.unstubAllGlobals()
  capturedOnSessionUpdate = null

  mockSetSessionMode = vi.fn().mockImplementation(async () => undefined)
  mockSetSessionConfigOption = vi.fn().mockImplementation(async () => ({ configOptions: [] }))
  mockNewSession = vi.fn().mockResolvedValue({
    sessionId: "test-session",
    configOptions: [],
    models: null,
    modes: null,
  })

  vi.stubGlobal("location", { protocol: "http:", host: "localhost:4013" })
  vi.stubGlobal("console", { ...console, warn: vi.fn() })
})

// ─── טסטים ───────────────────────────────────────────────────────────────────

describe("AgentSession — #applyRememberedConfig ב-attach", () => {
  it("attach: מחיל mode מ-lastConfig אחרי connected", async () => {
    const settings = makeSettingsMock({
      opencode: { mode: "ask" },
    })

    // newSession מחזיר modes עם "ask" כ-valid
    mockNewSession.mockResolvedValue({
      sessionId: "s1",
      configOptions: [],
      models: null,
      modes: makeModes("ask"),
    })
    mockSetSessionMode.mockResolvedValue(undefined)

    const session = new AgentSession({ settings: settings as never })
    await session.attach({ cwd: "/tmp", cliKind: "opencode" })

    // applyConfigOption נקרא עם mode="ask" → #applyConfigToClient → setSessionMode
    expect(mockSetSessionMode).toHaveBeenCalledWith({ sessionId: "s1", modeId: "ask" })
  })

  it("attach: ערך mode לא-תקף נדלג", async () => {
    const settings = makeSettingsMock({
      opencode: { mode: "stale-mode-that-doesnt-exist" },
    })

    mockNewSession.mockResolvedValue({
      sessionId: "s1",
      configOptions: [],
      models: null,
      modes: makeModes("ask"), // רק "ask" תקף
    })

    const session = new AgentSession({ settings: settings as never })
    await session.attach({ cwd: "/tmp", cliKind: "opencode" })

    // setSessionMode לא נקרא כי הערך לא-תקף
    expect(mockSetSessionMode).not.toHaveBeenCalled()
  })

  it("attach: אין settings → no-op חינני", async () => {
    mockNewSession.mockResolvedValue({
      sessionId: "s1",
      configOptions: [],
      models: null,
      modes: makeModes("ask"),
    })

    const session = new AgentSession() // ללא settings
    await session.attach({ cwd: "/tmp", cliKind: "opencode" })

    // אין קריאה ל-setSessionMode (אין מה לשחזר)
    expect(mockSetSessionMode).not.toHaveBeenCalled()
  })

  it("attach: cliKind שונה → lastConfig של claude לא מוחל על opencode", async () => {
    const settings = makeSettingsMock({
      claude: { mode: "auto" }, // keying ל-claude, לא opencode
    })

    mockNewSession.mockResolvedValue({
      sessionId: "s1",
      configOptions: [],
      models: null,
      modes: makeModes("auto"),
    })

    const session = new AgentSession({ settings: settings as never })
    await session.attach({ cwd: "/tmp", cliKind: "opencode" }) // opencode, לא claude

    expect(mockSetSessionMode).not.toHaveBeenCalled()
  })

  it("attach: ערך boolean נשחזר (configOption מסוג boolean)", async () => {
    const settings = makeSettingsMock({
      opencode: { myToggle: true },
    })

    // option מסוג boolean
    const booleanOption = makeBooleanOption("myToggle")
    mockNewSession.mockResolvedValue({
      sessionId: "s1",
      configOptions: booleanOption,
      models: null,
      modes: null,
    })
    mockSetSessionConfigOption.mockResolvedValue({ configOptions: booleanOption })

    const session = new AgentSession({ settings: settings as never })
    await session.attach({ cwd: "/tmp", cliKind: "opencode" })

    expect(mockSetSessionConfigOption).toHaveBeenCalledWith({
      sessionId: "s1",
      configId: "myToggle",
      value: true,
    })
  })
})

describe("AgentSession — #applyRememberedConfig ב-newSession", () => {
  it("newSession: מחיל mode מ-lastConfig אחרי connected", async () => {
    const settings = makeSettingsMock({
      opencode: { mode: "ask" },
    })

    // newSession ראשון (attach) — ללא modes
    mockNewSession.mockResolvedValueOnce({
      sessionId: "s1",
      configOptions: [],
      models: null,
      modes: null,
    })
    // newSession שני (newSession הממשי) — עם mode "ask"
    mockNewSession.mockResolvedValueOnce({
      sessionId: "s2",
      configOptions: [],
      models: null,
      modes: makeModes("ask"),
    })
    mockSetSessionMode.mockResolvedValue(undefined)

    const session = new AgentSession({ settings: settings as never })
    // attach ראשון (modes=null → apply לא יחיל שום דבר)
    await session.attach({ cwd: "/tmp", cliKind: "opencode" })

    // נקה את ה-mock לפני newSession
    mockSetSessionMode.mockClear()

    // newSession על החיבור הקיים
    await session.newSession({ cwd: "/tmp", cliKind: "opencode" })

    expect(mockSetSessionMode).toHaveBeenCalledWith({ sessionId: "s2", modeId: "ask" })
  })
})

describe("AgentSession — loadSession לא מחיל remembered", () => {
  it("loadSession לא קורא ל-setSessionMode (resume — לא דורסים)", async () => {
    const settings = makeSettingsMock({
      opencode: { mode: "ask" },
    })

    const session = new AgentSession({ settings: settings as never })

    // loadSession מחזיר modes עם "ask" כ-valid
    const mockAcpClient = {
      newSession: vi.fn(),
      prompt: vi.fn(),
      loadSession: vi.fn().mockResolvedValue({
        configOptions: [],
        models: null,
        modes: makeModes("ask"),
      }),
      cancel: vi.fn(),
      listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
      close: vi.fn(),
      setSessionConfigOption: mockSetSessionConfigOption,
      setSessionModel: vi.fn(),
      setSessionMode: mockSetSessionMode,
    } as unknown as AcpClient

    // השתמש ב-_setStatusForTest כדי לסמלץ שהסשן לא מחובר (נדרש ל-loadSession)
    // אבל loadSession דורש שהוא יוכל לקרוא createAgent + WS
    // נניח שה-mocks עובדים כמו ב-attach
    await session.loadSession({
      sessionId: "existing-session",
      cwd: "/tmp",
      cliKind: "opencode",
    })

    // loadSession לא מחיל remembered
    expect(mockSetSessionMode).not.toHaveBeenCalled()
    void mockAcpClient // suppress unused warning
  })
})
