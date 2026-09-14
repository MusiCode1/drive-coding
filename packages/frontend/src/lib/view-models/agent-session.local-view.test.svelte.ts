/**
 * agent-session.local-view.test.svelte.ts — slice local-view-wiring C3 (DoD 8-17).
 *
 * ה-VM קושר LocalSessionView ללקוח בשלושת אתרי-היצירה ומאמץ בחמש נקודות; כאן
 * מוכח שכל מה ש"השתק" במסלול ה-local ממשיך לעבוד — בלי להפיל את ה-WS, בלי
 * להכפיל בועות, בלי לאבד היסטוריה, ובלי להשאיר drains יתומים.
 *
 * מוקים: createAcpClient/createAttachedAcpClient (לוכדים את ה-callbacks המחוברים
 * — כלומר את ה-tee), WsAcpTransport (תור התנהגויות per-instance — ל-retry של MED-8),
 * agents-api, ול-LocalSessionView: subclass לוכד-מופעים שעוטף את read() של ה-drain
 * כדי לסמן סיום-ניקוז (הטכניקה שב-DoD 12).
 */

import type { Patch } from "@drive-coding/core/session"
import type { AcpClient, AcpClientCallbacks } from "@drive-coding/provider/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ViewEmission } from "$lib/session/session-view"

// ─── Module-level mocks ───────────────────────────────────────────────────────

type TransportFn = ReturnType<typeof vi.fn>

const vh = vi.hoisted(() => {
  const replayLoad = (callbacks: AcpClientCallbacks | null): void => {
    // מחזיר היסטוריה "תוך כדי" loadSession — כמו CLI חי (§2.6): שתי הודעות.
    callbacks?.onUpdate?.({
      update: {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "replayed user" },
        messageId: "replay-user-1",
      },
    } as never)
    callbacks?.onUpdate?.({
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "replayed assistant" },
        messageId: "replay-agent-1",
      },
    } as never)
  }

  const rawClient = {
    newSession: vi.fn().mockResolvedValue({ sessionId: "sess-new" }),
    loadSession: vi.fn().mockImplementation(async () => {
      replayLoad(state.teedCallbacks)
      return { sessionId: "sess-load" }
    }),
    prompt: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    extMethod: vi.fn().mockResolvedValue({ snapshot: null }),
    listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    setSessionConfigOption: vi.fn().mockResolvedValue({ configOptions: [] }),
    setSessionMode: vi.fn().mockResolvedValue(undefined),
    setSessionModel: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    conn: {},
    capabilities: { promptCapabilities: {}, sessionCapabilities: { delete: true } },
    authMethods: [{ id: "apiKey", name: "API Key" }],
  }
  // ל-VM: לקוח אגנוסטי (הטיפוס AcpClient מוחק את ה-mocks) · לטסט: refs מטופסים אליהם.
  const client = rawClient as unknown as AcpClient

  const state = {
    client,
    /** refs מטופסים ל-mocks — mockResolvedValue/Impl זמינים רק דרכם (AcpClient מוחק). */
    newSessionMock: rawClient.newSession,
    loadSessionMock: rawClient.loadSession,
    setSessionConfigOptionMock: rawClient.setSessionConfigOption,
    extMethodMock: rawClient.extMethod,
    createCount: { acp: 0, attached: 0 },
    /** ה-callbacks שנמסרו ליצירת הלקוח — כלומר ה-tee. */
    teedCallbacks: null as (AcpClientCallbacks & { onUpdate: TransportFn }) | null,
    /** רשימת ה-transports שנוצרו (per-instance behavior). */
    transports: [] as Array<{
      close: TransportFn
      closeAndWait: TransportFn
      waitForOpen: TransportFn
      fireClose: (code: number, reason: string) => void
    }>,
    /** תור התנהגויות WS — ה-transport ה-i נוצר לפי behavior ה-i. */
    queue: [] as Array<{ mode: "open" } | { mode: "fail-open"; code: number; reason: string }>,
    /** true → קריאת ה-createAcpClient הבאה נכשלת (DoD 12c). */
    failNextCreate: false,
  }
  return { state }
})

vi.mock("@drive-coding/acp-wire/browser", () => ({
  WsAcpTransport: vi.fn(function MockTransport() {
    const behavior = vh.state.queue.shift() ?? { mode: "open" }
    let closeCb: ((code: number, reason: string) => void) | null = null
    const t = {
      onClose: vi.fn((cb: (code: number, reason: string) => void) => {
        closeCb = cb
      }),
      waitForOpen: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      closeAndWait: vi.fn().mockResolvedValue(undefined),
      fireClose: (code: number, reason: string) => closeCb?.(code, reason),
    }
    if (behavior.mode === "open") t.waitForOpen.mockResolvedValue(undefined)
    else t.waitForOpen.mockImplementation(() => new Promise(() => {})) // לעולם לא נפתח — ה-race מחליט
    vh.state.transports.push(t)
    return t
  }),
}))

vi.mock("@drive-coding/provider/client", async (importActual) => {
  const actual = await importActual<typeof import("@drive-coding/provider/client")>()
  return {
    ...actual,
    createAcpClient: vi.fn(function mockCreateClient(
      _transport: unknown,
      callbacks: unknown,
    ): Promise<AcpClient> {
      vh.state.createCount.acp++
      vh.state.teedCallbacks = callbacks as (typeof vh.state)["teedCallbacks"]
      if (vh.state.failNextCreate) {
        vh.state.failNextCreate = false
        return Promise.reject(new Error("handshake failed (DoD 12c)"))
      }
      return Promise.resolve(vh.state.client)
    }),
    createAttachedAcpClient: vi.fn(function mockAttachedClient(
      _transport: unknown,
      callbacks: unknown,
    ): AcpClient {
      vh.state.createCount.attached++
      vh.state.teedCallbacks = callbacks as (typeof vh.state)["teedCallbacks"]
      return vh.state.client
    }),
  }
})

vi.mock("$lib/adapters/agents-api", () => ({
  createAgent: vi.fn().mockResolvedValue({ agentId: "test-agent" }),
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  notifySessionAttached: vi.fn().mockResolvedValue(undefined),
  listAgents: vi.fn().mockResolvedValue([]),
}))

vi.mock("$lib/adapters/sessions", () => ({
  normalizeSessionInfo: vi.fn((x: unknown) => x),
}))

// subclass לוכד-מופעים: ידית ל-view שכבר אופס (DoD 12), סמן-סיום-nikוז, seam ל-DoD 16.
vi.mock("$lib/session/local-session-view", async (importActual) => {
  const actual = await importActual<typeof import("$lib/session/local-session-view")>()
  return {
    ...actual,
    LocalSessionView: class CapturedLocalSessionView extends actual.LocalSessionView {
      drainEnded = false
      static instances: CapturedLocalSessionView[] = []
      static throwOnUpdate = false

      constructor(opts: ConstructorParameters<typeof actual.LocalSessionView>[0]) {
        super(opts)
        const stream = this.patches
        const origGetReader = stream.getReader.bind(stream)
        // ה-drain מחזיק את ה-reader היחיד; עוטפים את read() כדי לסמן done.
        // ⚠️ patches הוא readonly-טיפוסית — השמה בזמן-ריצה בלבד (seam של טסט).
        ;(
          stream as unknown as { getReader: () => ReadableStreamDefaultReader<ViewEmission> }
        ).getReader = () => {
          const reader = origGetReader()
          const origRead = reader.read.bind(reader)
          ;(
            reader as unknown as {
              read: () => Promise<ReadableStreamReadResult<ViewEmission>>
            }
          ).read = async () => {
            const res = await origRead()
            if (res.done) this.drainEnded = true
            return res
          }
          return reader
        }
        CapturedLocalSessionView.instances.push(this)
      }

      /** DoD 16: כשה-dגל דלוק — ה-observer זורק (התוספת החדשה היחידה ל-view). */
      override get observerCallbacks(): Pick<AcpClientCallbacks, "onUpdate" | "onExtNotification"> {
        const base = super.observerCallbacks
        if (CapturedLocalSessionView.throwOnUpdate) {
          return {
            ...base,
            onUpdate: () => {
              throw new Error("observer exploded (DoD 16)")
            },
          }
        }
        return base
      }
    },
  }
})

// ─── Import after mocks ───────────────────────────────────────────────────────

import { AgentSession } from "./agent-session.svelte"
import type { Settings } from "./settings.svelte"

// ה-subclass הלוכד מוגדר בתוך ה-factory של vi.mock — נשלף כאן דינמית (אחרי ה-mock,
// כמו הדפוס הקיים ב-agent-session.test.ts: warm path נטען דינמית אחרי ה-mocks).
// הסיבה לדינמיות: רק כך מתקבלת הכיתת ה-mocked, לא המקורית.
type CapturedViewLike = {
  drainEnded: boolean
  state: {
    sessionId: string | null
    messages: Array<{ role: string; segments: Array<{ text: string }> }>
    pending: { permission: unknown }
  }
}
const LocalSessionViewCaptured = (await import("$lib/session/local-session-view"))
  .LocalSessionView as unknown as {
  instances: CapturedViewLike[]
  throwOnUpdate: boolean
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

function lastView(): CapturedViewLike {
  const all = LocalSessionViewCaptured.instances
  const last = all[all.length - 1]
  if (!last) throw new Error("no LocalSessionView captured yet")
  return last
}
function getViews(): CapturedViewLike[] {
  return LocalSessionViewCaptured.instances
}
function setup(session: AgentSession): void {
  ;(
    session as unknown as { _mockFindReusableAgentForTest: (v: string | null) => void }
  )._mockFindReusableAgentForTest(null)
}
function sendReplayChunk(text: string, messageId: string): void {
  vh.state.teedCallbacks?.onUpdate?.({
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text },
      messageId,
    },
  } as never)
}

function makeSettingsMock(lastConfig: Record<string, Record<string, string | boolean>>) {
  return { lastConfig, setLastConfig: vi.fn() } as unknown as Settings
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  vh.state.createCount.acp = 0
  vh.state.createCount.attached = 0
  vh.state.teedCallbacks = null
  vh.state.transports = []
  vh.state.queue = []
  vh.state.failNextCreate = false
  LocalSessionViewCaptured.instances = []
  LocalSessionViewCaptured.throwOnUpdate = false
  vi.stubGlobal("location", { protocol: "http:", host: "localhost:4000" })
  vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("test-uuid") })
})

// ─── DoD 8 — לקוח אחד ────────────────────────────────────────────────────────

describe("DoD 8 — createAcpClient נקרא פעם אחת ב-attach; switch/newSession מוסיפים אפס", () => {
  it("attach → createAcpClient 1, createAttachedAcpClient 0", async () => {
    const session = new AgentSession()
    await session.attach({ cwd: "/tmp", cliKind: "opencode" })

    expect(vh.state.createCount.acp).toBe(1)
    expect(vh.state.createCount.attached).toBe(0)
  })

  it("אחרי attach: switchSession ו-newSession מקומיים — עדיין לקוח אחד", async () => {
    const session = new AgentSession()
    await session.attach({ cwd: "/tmp", cliKind: "opencode" })

    await session.switchSession({ sessionId: "sess-b", cwd: "/tmp", cliKind: "opencode" })
    await session.newSession({ cliKind: "opencode" })

    expect(vh.state.createCount.acp).toBe(1)
    expect(vh.state.createCount.attached).toBe(0)
  })
})

// ─── DoD 9 — ארבעת המסלולים ששקטו ────────────────────────────────────────────

describe("DoD 9 — המסלולים ששקטו עובדים עם view מאומץ ב-local", () => {
  it("loadSession: לא return שקט — status connected, view מאומץ, client אחד", async () => {
    const session = new AgentSession()
    await session.loadSession({ sessionId: "sess-1", cwd: "/tmp", cliKind: "opencode" })

    expect(session.status).toBe("connected")
    expect(vh.state.createCount.acp).toBe(1)
    expect(lastView().state.sessionId).toBe("sess-1")
    expect(vh.state.client.loadSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "sess-1" }),
    )
  })

  it("attachToLiveAgent: לא return שקט — warm רץ על ה-process החי", async () => {
    const session = new AgentSession()
    await session.attachToLiveAgent({
      agentId: "agent-live",
      sessionId: "sess-warm",
      cwd: "/tmp",
      cliKind: "opencode",
    })

    expect(vh.state.createCount.attached).toBe(1)
    expect(session.status).toBe("connected")
    expect(lastView().state.sessionId).toBe("sess-warm")
  })

  it("newSession מקומי: לא return שקט — לקוח קיים מרגיש את הקריאה", async () => {
    const session = new AgentSession()
    await session.attach({ cwd: "/tmp", cliKind: "opencode" })
    expect(vh.state.client.newSession).toHaveBeenCalledTimes(1)

    await session.newSession({ cliKind: "opencode" })

    expect(vh.state.client.newSession).toHaveBeenCalledTimes(2)
    expect(session.status).toBe("connected")
  })

  it("#coldReconnect: לא return שקט — loadSession רץ, view חדש מאומץ", async () => {
    const session = new AgentSession()
    await session.attach({ cwd: "/tmp", cliKind: "opencode" })
    setup(session)
    await (session as unknown as { _doReconnectForTest: () => Promise<void> })._doReconnectForTest()

    expect(session.status).toBe("connected")
    expect(vh.state.createCount.acp).toBe(2) // attach + cold-loadSession
    expect(lastView().state.sessionId).toBe("sess-new")
  })
})

// ─── DoD 10 — ה-WS שורד ──────────────────────────────────────────────────────

describe("DoD 10 — switchSession/newSession מקומיים לא סוגרים את ה-WS", () => {
  it("newSession מקומי: transport.close אפס פעמים, הסשן חי", async () => {
    const session = new AgentSession()
    await session.attach({ cwd: "/tmp", cliKind: "opencode" })

    await session.newSession({ cliKind: "opencode" })

    for (const t of vh.state.transports) expect(t.close).not.toHaveBeenCalled()
    expect(session.status).toBe("connected")
  })

  it("switchSession מקומי: transport.close אפס פעמים, prompt עובד אחרי", async () => {
    const session = new AgentSession()
    await session.attach({ cwd: "/tmp", cliKind: "opencode" })

    await session.switchSession({ sessionId: "sess-b", cwd: "/tmp", cliKind: "opencode" })
    await session.sendPrompt("still alive?")

    for (const t of vh.state.transports) expect(t.close).not.toHaveBeenCalled()
    expect(session.status).toBe("connected")
    expect(vh.state.client.prompt).toHaveBeenCalled()
  })
})

// ─── DoD 11 — ההיסטוריה שורדת ────────────────────────────────────────────────

describe("DoD 11 — ההיסטוריה המשוחזרת מגיעה ל-view.state", () => {
  it("אחרי loadSession: view.state.messages מכיל את ה-replay", async () => {
    const session = new AgentSession()
    await session.loadSession({ sessionId: "sess-1", cwd: "/tmp", cliKind: "opencode" })

    expect(lastView().state.messages.length).toBeGreaterThan(0)
    expect(
      lastView().state.messages.some(
        (m) => m.role === "assistant" && m.segments.some((s) => s.text === "replayed assistant"),
      ),
    ).toBe(true)
  })

  it("אחרי #warmReconnect: view.state.messages מכיל את ה-replay", async () => {
    const session = new AgentSession()
    await session.attachToLiveAgent({
      agentId: "agent-live",
      sessionId: "sess-warm",
      cwd: "/tmp",
      cliKind: "opencode",
    })

    expect(lastView().state.messages.length).toBeGreaterThan(0)
  })

  it("אחרי switchSession מקומי: אימוץ לפני ה-replay — ההיסטוריה לא נמחקת", async () => {
    const session = new AgentSession()
    await session.attach({ cwd: "/tmp", cliKind: "opencode" })
    const viewBefore = lastView()

    await session.switchSession({ sessionId: "sess-b", cwd: "/tmp", cliKind: "opencode" })

    // אותו view (אין בנייה מחדש — §4.3), state אומץ מחדש ומכיל את ה-replay
    expect(lastView()).toBe(viewBefore)
    expect(lastView().state.sessionId).toBe("sess-b")
    expect(lastView().state.messages.length).toBeGreaterThan(0)
  })
})

// ─── DoD 12 — הניקוז מסתיים ─────────────────────────────────────────────────

describe("DoD 12 — הניקוז (קורא-ריק על view.patches) מסתיים", () => {
  it("(א) אחרי cold: ה-view הישן שוחרר, ה-drain שלו יצא", async () => {
    const session = new AgentSession()
    await session.attach({ cwd: "/tmp", cliKind: "opencode" })
    const view0 = lastView()
    expect(view0.drainEnded).toBe(false)

    setup(session)
    await (session as unknown as { _doReconnectForTest: () => Promise<void> })._doReconnectForTest()

    await vi.waitFor(() => expect(view0.drainEnded).toBe(true))
    expect(getViews().length).toBeGreaterThanOrEqual(2)
    expect(lastView()).not.toBe(view0)
    // וה-drain של ה-view החדש חי עד שאחרי הסגירה
    await session.detach()
    await vi.waitFor(() => expect(lastView().drainEnded).toBe(true))
  })

  it("(ב) אחרי warm עם סיבוב retry: הסיבוב שנכשל לא הותיר view יתום, ה-bind פר-סיבוב מוצלח", async () => {
    vh.state.queue = [
      { mode: "fail-open", code: 1008, reason: "" }, // MED-8 → continue
      { mode: "open" },
    ]
    const session = new AgentSession()
    const attachPromise = session.attachToLiveAgent({
      agentId: "agent-live",
      sessionId: "sess-warm",
      cwd: "/tmp",
      cliKind: "opencode",
    })

    // סיבוב 0: ה-WS לא נפתח — ירה 1008 כדי שה-race יוכרע
    await vi.waitFor(() => expect(vh.state.transports.length).toBeGreaterThanOrEqual(1))
    const firstTransport = vh.state.transports[0]
    if (!firstTransport) throw new Error("expected at least one transport")
    firstTransport.fireClose(1008, "")
    await attachPromise

    expect(vh.state.transports.length).toBe(2) // ה-retry אכן קרה
    expect(vh.state.createCount.attached).toBe(1) // לקוח רק בסיבוב המוצלח
    expect(getViews().length).toBe(1) // הסיבוב הכושל לא קשר view
    expect(lastView().state.sessionId).toBe("sess-warm")

    await session.detach()
    await vi.waitFor(() => expect(lastView().drainEnded).toBe(true))
  })

  it("(ג) attach שנכשל אחרי #bindLocalView: ה-drain של ה-view שלא אומץ יוצא (דרך #cleanup:2522)", async () => {
    vh.state.failNextCreate = true
    const session = new AgentSession()
    await session.attach({ cwd: "/tmp", cliKind: "opencode" }).catch(() => {})

    expect(session.status).toBe("error")
    expect(getViews().length).toBe(1)
    const unadoptedView = lastView()
    // ה-drain של ה-view שלא אומץ יוצא דרך #cleanup:2522 (close() סוגר את ה-controller)
    await vi.waitFor(() => expect(unadoptedView.drainEnded).toBe(true))
    expect(vh.state.client.newSession).not.toHaveBeenCalled() // לא אומץ — session/never הרץ
  })

  // ─── (ד) תיקון-במקום: calev ממצא 3 · freebuff ממצא 1 ───
  // ה-warm **נפתח** (bind+adopt רצו) ואז loadSession נכשל. זה **לא** מקרה (ב):
  // שם ה-WS לא נפתח כלל וה-bind לא הגיע. כאן ה-catch של #warmReconnect חייב
  // לשחרר בעצמו — ל-attachToLiveAgent אין fallback קר שיכסה עליו.
  it("(ד) warm שנפתח ואז loadSession נכשל: ה-catch משחרר, ה-drain יוצא, אין view יתום", async () => {
    vh.state.loadSessionMock.mockRejectedValueOnce(new Error("load failed after open"))
    const session = new AgentSession()

    await session.attachToLiveAgent({
      agentId: "agent-live",
      sessionId: "sess-warm",
      cwd: "/tmp",
      cliKind: "opencode",
    })

    expect(vh.state.createCount.attached).toBe(1) // ה-WS אכן נפתח והלקוח נוצר
    expect(getViews().length).toBe(1) // bind רץ — יש view
    expect(session.status).toBe("error") // אין fallback קר במסלול הזה

    // 🔴 הליבה: בלי dispose ב-catch, ה-read() נשאר תלוי לנצח.
    await vi.waitFor(() => expect(lastView().drainEnded).toBe(true))
  })
})

// ─── DoD 13 — ששת הצעדים מסביב ללקוח ─────────────────────────────────────────

describe("DoD 13 — authMethods · _meta · captureSessionConfig · notify · applyRememberedConfig · ext", () => {
  it("אף אחד מששת הצעדים לא נשבר בקשירה/אימוץ", async () => {
    const richOptions = [
      {
        id: "mode",
        type: "select",
        category: "mode",
        name: "Mode",
        currentValue: "default",
        options: [{ value: "default", label: "Default" }],
      },
    ]
    vh.state.newSessionMock.mockResolvedValue({
      sessionId: "sess-new",
      configOptions: richOptions,
      models: { currentModelId: "llm-1", availableModels: [{ modelId: "llm-1", name: "LLM 1" }] },
      modes: { currentModeId: "default", availableModes: [{ id: "default", name: "Default" }] },
    })
    // #applyConfigToClient מעדכן configOptions מתשובת ה-RPC — הד לאותם options (אחרת
    // applyRememberedConfig דורס את ה-capture בתשובה ריקה, והפלט הופך misleading).
    vh.state.setSessionConfigOptionMock.mockResolvedValue({ configOptions: richOptions })
    const settings = makeSettingsMock({ claude: { mode: "default" } })
    const session = new AgentSession({ settings })
    await session.attach({ cwd: "/proj", cliKind: "claude" })

    // 1. authMethods נשמרו מה-client
    expect(session.authMethods.length).toBeGreaterThan(0)

    // 2. _meta הוזרק ל-newSession (claude)
    expect(vh.state.client.newSession).toHaveBeenCalledWith(
      expect.objectContaining({
        _meta: expect.objectContaining({ claudeCode: expect.anything() }),
      }),
    )

    // 3. #captureSessionConfig — configOptions/models/modes מלאים
    expect(session.configOptions.length).toBeGreaterThan(0)
    expect(session.models?.currentModelId).toBe("llm-1")
    expect(session.modes?.currentModeId).toBe("default")

    // 4. notifySessionAttached נקרא
    const { notifySessionAttached } = await import("$lib/adapters/agents-api")
    expect(notifySessionAttached).toHaveBeenCalledWith("test-agent", "sess-new")

    // 5. #applyRememberedConfig רץ (mode="default" עבר isValidChoice → setSessionConfigOption)
    expect(vh.state.client.setSessionConfigOption).toHaveBeenCalledWith(
      expect.objectContaining({ configId: "mode", value: "default" }),
    )

    // 6. #ext נצפה דרך התנהגות: זורעים capabilities.usage ואז refreshQuota מגיע לחוט
    vh.state.teedCallbacks?.onExtNotification?.("_drive/capabilities", {
      usage: true,
      mcp: false,
      compact: false,
      commands: false,
      configOptions: false,
      rename: false,
      thinkingTokens: false,
      image: false,
      systemPrompt: "unsupported",
    } as never)
    await session.refreshQuota()
    expect(vh.state.client.extMethod).toHaveBeenCalledWith(
      "_drive/getQuota",
      expect.objectContaining({ sessionId: "sess-new" }),
    )
  })
})

// ─── DoD 14 — אין בועה כפולה ─────────────────────────────────────────────────

describe("DoD 14 — הודעה אחת → בועה אחת (הניקוז לא מכפיל)", () => {
  it("chunk יחיד דרך ה-tee → בועה אחת ב-VM", async () => {
    const session = new AgentSession()
    await session.attach({ cwd: "/tmp", cliKind: "opencode" })

    sendReplayChunk("single bubble", "m-1")
    // שים לב: אין כאן ניקוז-כתיבה — ה-drain הוא קורא-ריק (§4.5)
    expect(session.bubbles.filter((b) => b.kind === "message")).toHaveLength(1)
  })

  it("שלושה chunks לאותו messageId → בועה אחת עם שלושה segments", async () => {
    const session = new AgentSession()
    await session.attach({ cwd: "/tmp", cliKind: "opencode" })

    sendReplayChunk("a", "m-2")
    sendReplayChunk("b", "m-2")
    sendReplayChunk("c", "m-2")

    const msgs = session.bubbles.filter((b) => b.kind === "message")
    expect(msgs).toHaveLength(1)
    const segments = (msgs[0] as { segments: { text: string }[] }).segments
    expect(segments.map((s) => s.text).join("")).toBe("abc")
  })
})

// ─── DoD 15 — הרשאה לא מוכפלת ────────────────────────────────────────────────

describe("DoD 15 — onRequestPermission → תגובה אחת, מה-VM", () => {
  it("ה-view לא ראה את הבקשה; ה-VM עונה פעם אחת", async () => {
    const session = new AgentSession()
    await session.attach({ cwd: "/tmp", cliKind: "opencode" })

    const fakeParams = {
      sessionId: "sess-new",
      toolCall: {},
      options: [{ optionId: "allow_once", name: "Allow", kind: "allow_once" }],
    }
    let responses: unknown[] = []
    const teed = vh.state.teedCallbacks
    const requestPermission = teed?.onRequestPermission
    if (!requestPermission) throw new Error("expected teed onRequestPermission")
    const p = requestPermission(fakeParams as never)
    p.then((r) => {
      responses = [r]
    })

    // ה-VM החזיק את הבקשה — לא ה-view
    expect(session.pendingPermission).not.toBeNull()
    expect(lastView().state.pending.permission).toBeNull()

    const pending = session.pendingPermission
    if (!pending) throw new Error("expected pending permission")
    pending.resolve({ outcome: { outcome: "selected", optionId: "allow_once" } })
    await Promise.resolve()
    expect(responses).toHaveLength(1)
  })
})

// ─── DoD 16 — ה-observer מבודד ───────────────────────────────────────────────

describe("DoD 16 — throw ב-view.#onUpdate לא נוגע ל-VM", () => {
  it("ה-VM ממשיך, בועות נשמרות", async () => {
    const session = new AgentSession()
    await session.attach({ cwd: "/tmp", cliKind: "opencode" })

    LocalSessionViewCaptured.throwOnUpdate = true
    sendReplayChunk("kept", "m-safe")

    expect(session.status).toBe("connected") // לא קרס
    expect(session.bubbles.filter((b) => b.kind === "message")).toHaveLength(1)
  })
})
