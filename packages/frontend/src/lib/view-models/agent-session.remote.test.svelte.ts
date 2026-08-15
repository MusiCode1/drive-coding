/**
 * agent-session.remote.test.svelte.ts — VM ↔ remote (#view) wiring (C3).
 *
 * Testing: integration (brief §C3)
 *
 * רוב ההתנהגויות נבדקות דרך constructor DI (`new AgentSession({ view: mock })`) —
 * `MockSessionView` (`__fixtures__/mock-session-view.svelte.ts`) מדמה את החוט:
 * `fireUpdate` לאירועי session/update גולמיים (reduce), `applyAndEmit` ל-update-session
 * patches ש-reduce לא מכיר עליהם (pending/turnState/lastTurnError) — בונים אותם עם
 * `applyPendingRequest`/`clearPendingRequest`/`applyTurnEnd` מ-core, בדיוק כמו ה-remote
 * contract harness ב-C1 (לא patches מפוברקים ידנית).
 *
 * `attachRemote` עצמו (HTTP `createAgent` + SSE `createRemoteView`) נבדק ישירות רק
 * במסלול כשל-מהיר (sessionId===null) — `$lib/adapters/agents-api` ממוקק ברמת המודול,
 * ו-`global.fetch` ממוקק לבקשת ה-SSE. שאר הטסטים לא צריכים למקק HTTP כלל.
 *
 * ─── slice view-switch C3 (integration) ───
 */

import {
  applyPendingRequest,
  applyTurnEnd,
  applyTurnStart,
  clearPendingRequest,
  createInitialSessionState,
} from "@drive-coding/core/session"
import type { AcpClient } from "@drive-coding/provider/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createAgent, deleteAgent, notifySessionAttached } from "$lib/adapters/agents-api"
import type { Settings } from "$lib/view-models/settings.svelte"

// ─── Module-level mocks (חייבים להיות לפני import AgentSession — נדרש לרגרסיית ה-local) ───

vi.mock("@drive-coding/provider/client", async (importActual) => {
  const actual = await importActual<typeof import("@drive-coding/provider/client")>()
  return {
    ...actual,
    createAcpClient: vi.fn(async () => localClientMock),
  }
})

vi.mock("$lib/engines/ws-transport", () => ({
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
  createAgent: vi.fn().mockResolvedValue({ agentId: "remote-test-agent" }),
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  notifySessionAttached: vi.fn().mockResolvedValue(undefined),
  listAgents: vi.fn().mockResolvedValue([]),
  patchAgent: vi.fn().mockResolvedValue(undefined),
}))

// mutable — כל טסט-רגרסיה מעצב אותו מחדש ב-beforeEach
let localClientMock: AcpClient

// ─── Import after mocks ───────────────────────────────────────────────────────

import { MockSessionView } from "./__fixtures__/mock-session-view.svelte"
import { AgentSession } from "./agent-session.svelte"

// ─── helpers ────────────────────────────────────────────────────────────────

function delay(ms = 10): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function makeSettingsMock(): Settings {
  return { setLastConfig: vi.fn() } as unknown as Settings
}

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.stubGlobal("location", { protocol: "http:", host: "localhost:4013", search: "" })
  localClientMock = {
    newSession: vi.fn().mockResolvedValue({ sessionId: "local-sess-1" }),
    loadSession: vi.fn().mockResolvedValue({}),
    prompt: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    extMethod: vi.fn().mockResolvedValue({ snapshot: null }),
    listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    setSessionConfigOption: vi.fn().mockResolvedValue({ configOptions: [] }),
    setSessionMode: vi.fn().mockResolvedValue(undefined),
    setSessionModel: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    conn: {} as AcpClient["conn"],
    capabilities: {} as AcpClient["capabilities"],
    authMethods: [],
  } as unknown as AcpClient
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── sendPrompt ───────────────────────────────────────────────────────────────

describe("AgentSession + remote view — sendPrompt", () => {
  let view: MockSessionView
  let agent: AgentSession

  beforeEach(() => {
    view = new MockSessionView()
    view.connect("remote-sess-1")
    agent = new AgentSession({ view })
    agent._setStatusForTest("connected")
  })

  it("reaches the view as PromptBlocks, meta undefined, no local bubble, sets waiting", async () => {
    await agent.sendPrompt("hello there")

    expect(view.promptMock).toHaveBeenCalledWith([{ type: "text", text: "hello there" }], undefined)
    expect(agent.bubbles).toHaveLength(0) // ה-BE מסנתז את בועת-המשתמש — לא כאן
    // 🔴 turnState נשאר waiting אחרי שה-promise נפתר — ה-202 אינו סוף התור
    expect(agent.turnState).toBe("waiting")
  })

  it("a patch with turnState:'idle' brings turnState down to idle (via the BE, not the RPC response)", async () => {
    await agent.sendPrompt("hello")
    expect(agent.turnState).toBe("waiting")

    view.applyAndEmit({ version: 1, op: "update-session", changes: { turnState: "idle" } })
    await delay()

    expect(agent.turnState).toBe("idle")
  })

  it("a prompt rejection (HTTP failure) sets session.error — not #setStatus('error')", async () => {
    view.promptMock.mockRejectedValueOnce(
      new Error("RemoteSessionView: POST .../rpc failed with status 500"),
    )

    await agent.sendPrompt("hello")

    expect(agent.error).toContain("prompt failed")
    // ⚠️ status="error" ב-remote היה נועל sendPrompt לצמיתות — ה-SessionHost חי לגמרי
    expect(agent.status).toBe("connected")
  })

  // ─── slice remote-images C2: image support (r3) ───
  it("image-only send in remote mode — sends PromptBlocks with image block (r3: supported)", async () => {
    await agent.sendPrompt("", { attachments: [{ mimeType: "image/png", dataBase64: "AA==" }] })

    expect(view.promptMock).toHaveBeenCalledWith(
      [{ type: "image", mimeType: "image/png", data: "AA==" }],
      undefined,
    )
    expect(agent.error).toBeNull() // r3: no error — images supported in remote
    expect(agent.turnState).toBe("waiting")
  })

  it("text + attachments in remote mode — sends PromptBlocks without warning (r3)", async () => {
    await agent.sendPrompt("hello", {
      attachments: [{ mimeType: "image/png", dataBase64: "AA==" }],
    })

    expect(view.promptMock).toHaveBeenCalledWith(
      [
        { type: "text", text: "hello" },
        { type: "image", mimeType: "image/png", data: "AA==" },
      ],
      undefined,
    )
    expect(agent.error).toBeNull() // r3: no warning
  })
})

// ── cancelTurn ────────────────────────────────────────────────────────────────

describe("AgentSession + remote view — cancelTurn", () => {
  it("resolves pending permission (view.respond) + calls view.cancel() + sets idle", async () => {
    const view = new MockSessionView()
    view.connect("remote-sess-2")
    const agent = new AgentSession({ view })
    agent._setStatusForTest("connected")

    const { patches } = applyPendingRequest(view.state, {
      kind: "permission",
      value: { requestId: 1, params: { options: [] } as never },
    })
    view.applyAndEmit(patches[0]!)
    await delay()
    expect(agent.pendingPermission).not.toBeNull()

    // turnState חייב not-idle כדי ש-cancelTurn לא יחזור מוקדם
    view.applyAndEmit({ version: 2, op: "update-session", changes: { turnState: "waiting" } })
    await delay()
    expect(agent.turnState).toBe("waiting")

    await agent.cancelTurn()

    expect(view.respondMock).toHaveBeenCalledWith(1, { outcome: { outcome: "cancelled" } })
    expect(agent.pendingPermission).toBeNull()
    expect(view.cancelMock).toHaveBeenCalled()
    expect(agent.turnState).toBe("idle")
  })
})

// ── applyConfigOption ────────────────────────────────────────────────────────

describe("AgentSession + remote view — applyConfigOption", () => {
  it("routes 'mode' to view.setMode when no configOptions match", async () => {
    const view = new MockSessionView()
    view.connect("remote-sess-3")
    const agent = new AgentSession({ view })
    agent._setStatusForTest("connected")

    await agent.applyConfigOption("mode", "ask")

    expect(view.setModeMock).toHaveBeenCalledWith("ask")
  })

  it("routes to view.setConfigOption when an option with matching id exists", async () => {
    const view = new MockSessionView()
    view.connect("remote-sess-4")
    const agent = new AgentSession({ view })
    agent._setStatusForTest("connected")
    view.applyAndEmit({
      version: 1,
      op: "update-session",
      changes: {
        configOptions: [
          { id: "verbosity", category: "other", name: "Verbosity", type: "boolean", value: false },
        ] as never,
      },
    })
    await delay()

    await agent.applyConfigOption("verbosity", true)

    expect(view.setConfigOptionMock).toHaveBeenCalledWith("verbosity", true)
  })

  it("model with no configOptions match routes to view.setSessionModel", async () => {
    const view = new MockSessionView()
    view.connect("remote-sess-5")
    const agent = new AgentSession({ view })
    agent._setStatusForTest("connected")

    await agent.applyConfigOption("model", "claude-opus")

    expect(view.setSessionModelMock).toHaveBeenCalledWith("claude-opus")
  })

  it("unknown configId with no match is a silent skip — no RPC sent", async () => {
    const view = new MockSessionView()
    view.connect("remote-sess-6")
    const agent = new AgentSession({ view })
    agent._setStatusForTest("connected")

    await agent.applyConfigOption("unknown-thing", "x")

    expect(view.setConfigOptionMock).not.toHaveBeenCalled()
    expect(view.setModeMock).not.toHaveBeenCalled()
    expect(view.setSessionModelMock).not.toHaveBeenCalled()
  })
})

// ── pending sync + guard-זהות ───────────────────────────────────────────────

describe("AgentSession + remote view — pending sync (guard-זהות)", () => {
  it("pending syncs, the shim routes respond(), and a replayed patch does not reopen an answered dialog", async () => {
    const view = new MockSessionView()
    view.connect("remote-sess-7")
    const agent = new AgentSession({ view })
    agent._setStatusForTest("connected")

    const req = applyPendingRequest(view.state, {
      kind: "permission",
      value: { requestId: 5, params: { options: [] } as never },
    })
    view.applyAndEmit(req.patches[0]!)
    await delay()
    expect(agent.pendingPermission).not.toBeNull()
    expect(agent.pendingPermission?.requestId).toBe(5)

    // המשתמשת עונה — ה-shim אמור לנתב ל-view.respond ולסמן #answeredPermissionId
    agent.pendingPermission?.resolve({ outcome: { outcome: "selected", optionId: "allow_once" } })
    await delay()
    expect(view.respondMock).toHaveBeenCalledWith(5, {
      outcome: { outcome: "selected", optionId: "allow_once" },
    })

    // ה-BE מנקה את ה-pending בתשובה (patch אמיתי, לא ידני)
    const cleared = clearPendingRequest(req.state, "permission", 5)
    view.applyAndEmit(cleared.patches[0]!)
    await delay()
    expect(agent.pendingPermission).toBeNull()

    // patch שהיה באוויר (אותו requestId, שוב "פתוח") — לא אמור לפתוח מחדש דיאלוג שנענה
    view.applyAndEmit(req.patches[0]!)
    await delay()
    expect(agent.pendingPermission).toBeNull()
  })

  it("pending carries both permission and elicitation fields on the same patch (non-deep-merge trap)", async () => {
    const view = new MockSessionView()
    view.connect("remote-sess-8")
    const agent = new AgentSession({ view })
    agent._setStatusForTest("connected")

    const permReq = applyPendingRequest(view.state, {
      kind: "permission",
      value: { requestId: 1, params: { options: [] } as never },
    })
    view.applyAndEmit(permReq.patches[0]!)
    await delay()
    expect(agent.pendingPermission).not.toBeNull()

    const elicReq = applyPendingRequest(permReq.state, {
      kind: "elicitation",
      value: { requestId: 2, params: { mode: "form" } as never },
    })
    view.applyAndEmit(elicReq.patches[0]!)
    await delay()

    // שני ה-pending חייבים לשרוד יחד — עדות ל-"pending חייב לשאת את שני השדות תמיד"
    expect(agent.pendingPermission).not.toBeNull()
    expect(agent.pendingElicitation).not.toBeNull()
  })
})

// ── lastTurnError → session.error ──────────────────────────────────────────

describe("AgentSession + remote view — lastTurnError", () => {
  it("lastTurnError syncs to session.error, and clearing it (null) clears the banner it wrote", async () => {
    const view = new MockSessionView()
    view.connect("remote-sess-9")
    const agent = new AgentSession({ view })
    agent._setStatusForTest("connected")

    const ended = applyTurnEnd(view.state, { message: "tool crashed", at: Date.now() })
    view.applyAndEmit(ended.patches[0]!)
    await delay()

    expect(agent.error).toContain("tool crashed")

    // applyTurnEnd על state שכבר idle+error הוא no-op ל-lastTurnError בלי מעבר דרך
    // waiting קודם (brief C1 כלל 3: מונע מחיקה בשקט של lastTurnError ע"י cancel-אחרי-כשל).
    const started = applyTurnStart(ended.state)
    view.applyAndEmit(started.patches[0]!)
    await delay()
    const cleared = applyTurnEnd(started.state)
    view.applyAndEmit(cleared.patches[0]!)
    await delay()

    expect(agent.error).toBeNull()
  })

  it("does not clear a warning whose origin isn't lastTurnError (e.g. 'reply failed')", async () => {
    const view = new MockSessionView()
    view.connect("remote-sess-10")
    const agent = new AgentSession({ view })
    agent._setStatusForTest("connected")

    agent.error = "reply failed"

    // applyTurnEnd על state שכבר idle+null הוא no-op (brief C1 כלל) — עוברים דרך
    // applyTurnStart קודם (waiting, lastTurnError:null) כדי שה-patch הבא יהיה אמיתי.
    const started = applyTurnStart(view.state)
    view.applyAndEmit(started.patches[0]!)
    await delay()
    const ended = applyTurnEnd(started.state)
    view.applyAndEmit(ended.patches[0]!)
    await delay()

    // "reply failed" לא מקורו ב-lastTurnError sync — שורד
    expect(agent.error).toBe("reply failed")
  })
})

// ── attachRemote — כשל-מהיר ─────────────────────────────────────────────────

describe("AgentSession — attachRemote fast-fail", () => {
  it("fails fast when the BE snapshot carries no sessionId — #cleanup runs, status=error", async () => {
    const encoder = new TextEncoder()
    const snapshot = createInitialSessionState({ sessionId: null })
    const sseText = `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/events")) {
        const body = new ReadableStream<Uint8Array>({
          start(ctrl) {
            ctrl.enqueue(encoder.encode(sseText))
            // keepOpen — לא סוגרים כדי לא להצית reconnect-loop עם setTimeout אמיתי
          },
        })
        return { ok: true, status: 200, body } as unknown as Response
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response
    })
    vi.stubGlobal("fetch", fetchMock)

    const agent = new AgentSession()
    await agent.attachRemote({ cwd: "/ws", cliKind: "claude" })

    expect(agent.status).toBe("error")
    expect(agent.error).toContain("did not provide a sessionId")
  })

  it("full flow: attachRemote succeeds (real sessionId) → applyConfigOption persists via #cliKind", async () => {
    const encoder = new TextEncoder()
    const snapshot = createInitialSessionState({ sessionId: "remote-sess-full" })
    const sseText = `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/events")) {
        const body = new ReadableStream<Uint8Array>({
          start(ctrl) {
            ctrl.enqueue(encoder.encode(sseText))
            // keepOpen — לא סוגרים כדי לא להצית reconnect-loop עם setTimeout אמיתי
          },
        })
        return { ok: true, status: 200, body } as unknown as Response
      }
      if (String(url).includes("/rpc")) {
        return { ok: true, status: 202, json: async () => ({ version: 1 }) } as unknown as Response
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response
    })
    vi.stubGlobal("fetch", fetchMock)

    const settings = makeSettingsMock()
    const agent = new AgentSession({ settings })
    await agent.attachRemote({ cwd: "/ws", cliKind: "claude" })

    expect(agent.status).toBe("connected")
    expect(agent.cwd).toBe("/ws") // attachRemote מציב גם cwd וגם #cliKind (כמו attach)

    await agent.applyConfigOption("mode", "ask")

    expect(settings.setLastConfig).toHaveBeenCalledWith("claude", "mode", "ask")
  })
})

// ── attachRemoteToLiveAgent — warm reconnect ב-remote (slice remote-warm-reconnect C3) ──

describe("AgentSession — attachRemoteToLiveAgent", () => {
  /** SSE body עם snapshot — אותו דפוס כמו טסטי attachRemote למעלה (keepOpen). */
  function sseFetchFor(
    snapshot: unknown,
    extra?: { onReply?: (body: unknown) => void },
  ): {
    fetchMock: ReturnType<typeof vi.fn>
  } {
    const encoder = new TextEncoder()
    const sseText = `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/events")) {
        const body = new ReadableStream<Uint8Array>({
          start(ctrl) {
            ctrl.enqueue(encoder.encode(sseText))
            // keepOpen — לא סוגרים כדי לא להצית reconnect-loop עם setTimeout אמיתי
          },
        })
        return { ok: true, status: 200, body } as unknown as Response
      }
      if (String(url).includes("/reply")) {
        extra?.onReply?.(init?.body ? JSON.parse(init.body as string) : undefined)
        return { ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response
    })
    return { fetchMock }
  }

  // ── slice empty-session-sync ──
  // סשן **חדש** הוא ריק ⇒ אין reset patch ⇒ הסנכרון שבתוך לולאת ה-patches
  // לא רץ לעולם. התוצאה: אין מוד/מודל ואין כפתור תמונה, עד שנטענת היסטוריה.
  // דווח ע"י המשתמשת ב-2026-08-15.
  it("empty session snapshot still syncs metadata (configOptions + capabilities)", async () => {
    const configOptions = [
      { id: "mode", name: "Mode", category: "mode", currentValue: "manual", availableValues: [] },
      { id: "model", name: "Model", category: "model", currentValue: "opus", availableValues: [] },
    ]
    const snapshot = {
      ...createInitialSessionState({ sessionId: "fresh-1" }),
      version: 3,
      // ⚠️ ללא messages — זה כל העניין. סשן חדש.
      configOptions,
      capabilities: {
        mcp: false,
        compact: false,
        commands: false,
        usage: false,
        configOptions: true,
        rename: false,
        thinkingTokens: false,
        image: true,
        systemPrompt: false,
      },
    }
    const { fetchMock } = sseFetchFor(snapshot)
    vi.stubGlobal("fetch", fetchMock)

    const agent = new AgentSession()
    await agent.attachRemoteToLiveAgent({ agentId: "fresh", cwd: "/ws", cliKind: "claude" })
    await delay()

    expect(agent.bubbles).toHaveLength(0) // באמת ריק
    expect(agent.configOptions).toHaveLength(2) // ⚠️ מוד ומודל
    expect(agent.capabilities?.image).toBe(true) // ⚠️ כפתור התמונה
    expect(agent.supportsImageInput).toBe(true)
  })

  // ── slice http-state-gaps C4 ──
  // refreshQuota ב-remote היה **מוחק** את המכסה: אין #ext (הוא נבנה מעל #client
  // שאינו קיים ב-remote), ולכן #doRefreshQuota נפל ל-`quota = null` ודרס ערך
  // תקין שהגיע מה-snapshot. הטסט מוודא שהערך שורד.
  it("C4: refreshQuota in remote does NOT wipe quota that arrived from the state channel", async () => {
    const quota = {
      provider: "claude",
      windows: [
        {
          id: "w1",
          period: { kind: "calendar" as const, unit: "month" as const },
          consumption: { kind: "percentage" as const, usedPct: 37 },
          resetsAtMs: null,
        },
      ],
    }
    const snapshot = {
      ...createInitialSessionState({ sessionId: "sess-q" }),
      version: 9,
      // ⚠️ חייבת להיות היסטוריה: #syncFromViewState נקרא רק בתוך לולאת ה-patches,
      // וסנאפשוט של סשן ריק אינו מייצר reset patch ⇒ שום מטא-דאטה לא מסונכרן.
      // חזרה לסשן היא ממילא תמיד עם היסטוריה, אז זה גם המצב המציאותי.
      messages: [
        { id: "m_0", role: "user", messageId: null, segments: [{ id: "s_0", text: "hi" }] },
      ],
      nextMessageSeq: 1,
      nextSegmentSeq: 1,
      // ⚠️ capabilities חייב להיות מלא — אובייקט חלקי מפיל את ולידציית הסנאפשוט
      // והוא נדחה בשלמותו. וגם: בלי usage:true, refreshQuota יוצא מוקדם
      // והטסט היה עובר מעצמו בלי לבדוק כלום.
      capabilities: {
        mcp: false,
        compact: false,
        commands: false,
        usage: true,
        configOptions: false,
        rename: false,
        thinkingTokens: false,
        image: false,
      },
      quota,
    }
    const { fetchMock } = sseFetchFor(snapshot)
    vi.stubGlobal("fetch", fetchMock)

    const agent = new AgentSession()
    await agent.attachRemoteToLiveAgent({ agentId: "live-q", cwd: "/ws", cliKind: "claude" })
    await delay()

    // ⚠️ טענה ישירה: בלעדיה, הסרת ההשמה ל-#sessionId לא נתפסת — refreshQuota
    // פשוט יוצא מוקדם, המכסה שורדת, והטסט עובר מהסיבה הלא-נכונה.
    expect(agent._sessionIdForTest()).toBe("sess-q")
    expect(agent.quota).toEqual(quota) // הגיע מהמצב

    await agent.refreshQuota() // פתיחת הפופאובר
    await delay()

    expect(agent.quota).toEqual(quota) // ⚠️ שרד — זו כל הבדיקה
    expect(agent.quotaLoading).toBe(false)
  })

  it("success: view created with the agentId — no createAgent — bubbles populated with the exact history", async () => {
    const messages = [
      { id: "m_0", role: "user", messageId: null, segments: [{ id: "s_0", text: "what is up" }] },
      {
        id: "m_1",
        role: "assistant",
        messageId: "p1",
        segments: [{ id: "s_1", text: "hello back" }],
      },
    ]
    const snapshot = {
      ...createInitialSessionState({ sessionId: "warm-sess-1" }),
      version: 9,
      messages,
      nextMessageSeq: 2,
      nextSegmentSeq: 2,
    }
    const { fetchMock } = sseFetchFor(snapshot)
    vi.stubGlobal("fetch", fetchMock)
    vi.mocked(createAgent).mockClear()
    vi.mocked(notifySessionAttached).mockClear()

    const agent = new AgentSession()
    await agent.attachRemoteToLiveAgent({ agentId: "live-agent-1", cwd: "/ws", cliKind: "claude" })

    expect(agent.status).toBe("connected")
    expect(agent.agentId).toBe("live-agent-1") // מ-input, לא מ-createAgent
    expect(agent.cwd).toBe("/ws")
    expect(createAgent).not.toHaveBeenCalled() // ❌ בלי createAgent — ה-host קיים ב-BE
    expect(notifySessionAttached).not.toHaveBeenCalled() // ❌ ה-BE הוא הבעלים (דווח ב-C1)

    // hydration: ה-bubbles מאוכלסים בדיוק-ההיסטוריה מה-snapshot (reset patch אחד)
    await delay()
    expect(agent.bubbles).toHaveLength(2)
    expect(agent.bubbles[0]).toMatchObject({
      kind: "user",
      id: "m_0",
      segments: [{ id: "s_0", text: "what is up" }],
    })
    expect(agent.bubbles[1]).toMatchObject({
      kind: "message",
      id: "m_1",
      segments: [{ id: "s_1", text: "hello back" }],
    })
    // רגרסיית כפילות חייבת להיכשל רועשת: כל message בדיוק פעם אחת
    expect(agent.bubbles.filter((b) => b.id === "m_0")).toHaveLength(1)
    expect(agent.bubbles.filter((b) => b.id === "m_1")).toHaveLength(1)
  })

  it("snapshot without sessionId → fast-fail: error surfaced, status=error, view closed", async () => {
    // pending permission ב-snapshot — close() שולח POST /reply עם cancelled; זה
    // ה-side-effect המדיד שה-view נסגר (close מבצע round-trip של ביטול pending).
    const replyBodies: unknown[] = []
    const snapshot = {
      ...createInitialSessionState({ sessionId: null }),
      pending: { permission: { requestId: 9, params: {} }, elicitation: null },
    }
    const { fetchMock } = sseFetchFor(snapshot, { onReply: (b) => replyBodies.push(b) })
    vi.stubGlobal("fetch", fetchMock)
    vi.mocked(createAgent).mockClear()
    vi.mocked(deleteAgent).mockClear()

    const agent = new AgentSession()
    await agent.attachRemoteToLiveAgent({ agentId: "live-agent-2", cwd: "/ws", cliKind: "claude" })

    expect(agent.status).toBe("error")
    expect(agent.error).toContain("did not provide a sessionId")
    expect(createAgent).not.toHaveBeenCalled()
    // view.close() רץ — ה-pending בוטל דרך POST /reply
    expect(replyBodies).toContainEqual(
      expect.objectContaining({ kind: "permission", requestId: 9 }),
    )
    // הסוכן החי שרד: keepAgent — deleteAgent לא נקרא (סטייה מתועדת מהבריף)
    expect(deleteAgent).not.toHaveBeenCalled()
  })

  it("duplication guard: status connected → throws, and no cleanup runs before the throw", async () => {
    const view = new MockSessionView()
    view.connect("remote-sess-guard")
    const agent = new AgentSession({ view })
    agent._setStatusForTest("connected")

    await expect(
      agent.attachRemoteToLiveAgent({ agentId: "x", cwd: "/ws", cliKind: "claude" }),
    ).rejects.toThrow(/cannot attach/)

    // אין cleanup לפני ה-throw — ה-view הקודם לא נסגר, ה-status לא נדרס
    expect(view.closeMock).not.toHaveBeenCalled()
    expect(agent.status).toBe("connected")
  })

  it("connect failure → status=error (not stuck on connecting), cleanup runs, live agent survives", async () => {
    // 503 מ-GET /events → SSEReader זורק → catch של attachRemoteToLiveAgent
    const fetchMock = vi.fn(
      async (_url: string) => ({ ok: false, status: 503 }) as unknown as Response,
    )
    vi.stubGlobal("fetch", fetchMock)
    vi.mocked(deleteAgent).mockClear()
    vi.mocked(createAgent).mockClear()

    const agent = new AgentSession()
    await agent.attachRemoteToLiveAgent({ agentId: "live-agent-3", cwd: "/ws", cliKind: "claude" })

    expect(agent.status).toBe("error")
    expect(agent.error).toContain("503")
    expect(agent.agentId).toBeNull() // #cleanup רץ (איפוס agentId)
    expect(createAgent).not.toHaveBeenCalled()
    expect(deleteAgent).not.toHaveBeenCalled() // keepAgent — הסוכן החי לא נמחק בכשל-חולף
  })
})

// ── loadSession/switchSession — no-op ב-remote ──────────────────────────────

describe("AgentSession + remote view — WS paths are blocked", () => {
  it("loadSession/switchSession/newSession/attachToLiveAgent are no-ops when #view is set", async () => {
    const view = new MockSessionView()
    view.connect("remote-sess-11")
    const agent = new AgentSession({ view })
    agent._setStatusForTest("connected")

    await agent.loadSession({ sessionId: "s", cwd: "/ws", cliKind: "claude" })
    await agent.switchSession({ sessionId: "s", cwd: "/ws", cliKind: "claude" })
    await agent.newSession({ cwd: "/ws", cliKind: "claude" })
    await agent.attachToLiveAgent({ agentId: "a", sessionId: "s", cwd: "/ws", cliKind: "claude" })

    // אף אחד מהם לא נגע ב-status/#view — עדיין connected, אין WS
    expect(agent.status).toBe("connected")
  })
})

// ── #cleanup — סוגר ומאפס את #view ──────────────────────────────────────────

describe("AgentSession + remote view — #cleanup teardown", () => {
  it("detach() closes the view and stops routing further patches from it (identity guard)", async () => {
    const view = new MockSessionView()
    view.connect("remote-sess-12")
    const agent = new AgentSession({ view })
    agent._setStatusForTest("connected")

    agent.detach()
    await delay()

    expect(view.closeMock).toHaveBeenCalled()
    expect(agent.status).toBe("idle")

    // patch שנשלח מה-view הישן אחרי detach לא אמור עוד להגיע ל-VM (#view !== view → break)
    const before = agent.bubbles.length
    view.applyAndEmit({
      version: 99,
      op: "add-message",
      message: {
        id: "m_99",
        role: "assistant",
        messageId: null,
        segments: [{ id: "s_0", text: "ghost" }],
      },
    })
    await delay()
    expect(agent.bubbles.length).toBe(before)
  })
})

// ── רגרסיה: בלי #view — הנתיב הקיים זהה ──────────────────────────────────────

describe("regression — local path unchanged (#view === null)", () => {
  it("attach + sendPrompt: optimistic bubble pushed, waiting→idle after RESP (unaffected by the C3-ב refactor)", async () => {
    const agent = new AgentSession()

    await agent.attach({ cwd: "/workspace", cliKind: "claude" })
    expect(agent.status).toBe("connected")

    await agent.sendPrompt("hi there")

    expect(agent.bubbles).toHaveLength(1)
    expect(agent.bubbles[0]?.kind).toBe("user")
    expect(agent.turnState).toBe("idle") // ← #turnEnded/#setTurnState("idle") עדיין רצים ב-local
    expect(localClientMock.prompt).toHaveBeenCalled()
  })

  it("sendPrompt catch still sets #setStatus('error') in local mode (unlike remote)", async () => {
    const agent = new AgentSession()
    await agent.attach({ cwd: "/workspace", cliKind: "claude" })

    vi.mocked(localClientMock.prompt).mockRejectedValueOnce(new Error("boom"))
    await agent.sendPrompt("hello")

    expect(agent.error).toContain("prompt failed")
    expect(agent.status).toBe("error") // ← local: #setStatus("error") עדיין רץ (בניגוד ל-remote)
  })

  it("cancelTurn still calls client.cancel() and sets idle in local mode", async () => {
    const agent = new AgentSession()
    await agent.attach({ cwd: "/workspace", cliKind: "claude" })
    await agent.sendPrompt("hi") // → turnState idle אחרי RESP; נדרוש מצב לא-idle לפני cancel
    agent.turnState = "waiting"

    await agent.cancelTurn()

    expect(localClientMock.cancel).toHaveBeenCalledWith("local-sess-1")
    expect(agent.turnState).toBe("idle")
  })
})
// ─── slice remote-session-mgmt C5: session management through the #view ───

describe("AgentSession + remote view — session management via #view (remote-session-mgmt C5)", () => {
  let view: MockSessionView
  let agent: AgentSession

  beforeEach(() => {
    view = new MockSessionView()
    view.connect("remote-sess-mgmt")
    agent = new AgentSession({ view })
    agent._setStatusForTest("connected")
  })

  it("listSessions through the view populates sessions (normalized in the view)", async () => {
    view.listSessionsMock.mockResolvedValueOnce([
      { sessionId: "s-1", cwd: "/a", title: "A", updatedAt: "" },
      { sessionId: "s-2", cwd: "/b", title: "B", updatedAt: "" },
    ])

    await agent.listSessions()

    expect(view.listSessionsMock).toHaveBeenCalledTimes(1)
    expect(agent.sessions).toHaveLength(2)
    expect(agent.sessions[0]?.sessionId).toBe("s-1")
    expect(agent.sessionsError).toBeNull()
  })

  it("listSessions with -32601 → empty list, sessionsError stays gentle/null (like local, no crash)", async () => {
    view.listSessionsMock.mockRejectedValueOnce(
      Object.assign(new Error("Method not found"), { code: -32601 }),
    )

    await agent.listSessions()

    expect(agent.sessions).toEqual([])
    // Gentle handling (DoD): no scary error — the empty list renders.
    expect(agent.sessionsError).toBeNull()
  })

  it("listSessions with a generic error → sessionsError is set", async () => {
    view.listSessionsMock.mockRejectedValueOnce(new Error("network down"))

    await agent.listSessions()

    expect(agent.sessionsError).toContain("network down")
  })

  it("deleteSession with -32601 → false (graceful no-op, button hidden)", async () => {
    view.deleteSessionMock.mockRejectedValueOnce(
      Object.assign(new Error("unsupported"), { code: -32601 }),
    )

    await expect(agent.deleteSession("s-x")).resolves.toBe(false)
    expect(agent.sessionsError).toBeNull()
  })

  it("deleteSession success removes optimistically; deleting the ACTIVE session detaches (wasActive)", async () => {
    // constructor DI does not sync #sessionId from the view — set it explicitly
    agent._setSessionContextForTest({
      sessionId: "remote-sess-mgmt",
      cwd: "/a",
      cliKind: "claude",
    })
    // Make the active session appear in the list.
    view.listSessionsMock.mockResolvedValueOnce([
      { sessionId: "remote-sess-mgmt", cwd: "/a", title: "", updatedAt: "" },
      { sessionId: "other", cwd: "/b", title: "", updatedAt: "" },
    ])
    await agent.listSessions()
    expect(agent.sessions).toHaveLength(2)

    // Deleting a NON-active session → optimistic removal, no detach
    await expect(agent.deleteSession("other")).resolves.toBe(false)
    expect(agent.sessions).toHaveLength(1)
    expect(view.closeMock).not.toHaveBeenCalled()

    // Deleting the ACTIVE session → wasActive true → detach() (view closed;
    // detach also clears sessions — same as local's onDisconnect pattern)
    await expect(agent.deleteSession("remote-sess-mgmt")).resolves.toBe(true)
    expect(view.closeMock).toHaveBeenCalled()
  })

  it("supportsSessionDelete follows the view's getter (true and false)", () => {
    expect(agent.supportsSessionDelete).toBe(false)
    view.supportsSessionDelete = true
    expect(agent.supportsSessionDelete).toBe(true)
    view.supportsSessionDelete = false
    expect(agent.supportsSessionDelete).toBe(false)
  })

  it("switchSession calls view.loadSession WITH cwd and syncs sessionId + cwd + title", async () => {
    await agent.switchSession({
      sessionId: "s-target",
      cwd: "/target/cwd",
      cliKind: "claude",
      title: "Target Title",
    })

    expect(view.loadSessionMock).toHaveBeenCalledWith("s-target", "/target/cwd")
    expect(agent.cwd).toBe("/target/cwd")
    expect(agent.sessionTitle).toBe("Target Title")
    expect(agent.isLoadingHistory).toBe(false)
    // #sessionId synced — proven via deleteSession wasActive on the new session
    await expect(agent.deleteSession("s-target")).resolves.toBe(true)
  })

  it("switchSession failure populates session.error and resets isLoadingHistory", async () => {
    view.loadSessionMock.mockRejectedValueOnce(
      new Error("RemoteSessionView: POST .../rpc failed with status 502"),
    )

    await agent.switchSession({ sessionId: "s-bad", cwd: "/x", cliKind: "claude" })

    expect(agent.error).toContain("switchSession failed")
    expect(agent.isLoadingHistory).toBe(false)
  })

  it("switchSession while another switch is in flight is blocked (serial guard)", async () => {
    let releaseLoad!: () => void
    view.loadSessionMock.mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseLoad = resolve)),
    )

    const first = agent.switchSession({ sessionId: "s-1", cwd: "/a", cliKind: "claude" })
    // isLoadingHistory is true while the first switch awaits — the second must be blocked.
    await expect(
      agent.switchSession({ sessionId: "s-2", cwd: "/b", cliKind: "claude" }),
    ).rejects.toThrow(/cannot switchSession/)

    releaseLoad()
    await first
    expect(view.loadSessionMock).toHaveBeenCalledTimes(1) // the blocked switch never loaded
  })

  it("switchSession when not connected is blocked (serial guard)", async () => {
    agent._setStatusForTest("idle")

    await expect(
      agent.switchSession({ sessionId: "s-x", cwd: "/x", cliKind: "claude" }),
    ).rejects.toThrow(/cannot switchSession/)
    expect(view.loadSessionMock).not.toHaveBeenCalled()
  })
})
