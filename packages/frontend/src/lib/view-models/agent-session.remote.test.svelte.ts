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

  it("reaches the view as a plain string, meta undefined, no local bubble, sets waiting", async () => {
    await agent.sendPrompt("hello there")

    expect(view.promptMock).toHaveBeenCalledWith("hello there", undefined)
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

  it("image-only send in remote mode does not POST an empty string", async () => {
    await agent.sendPrompt("", { attachments: [{ mimeType: "image/png", dataBase64: "AA==" }] })

    expect(view.promptMock).not.toHaveBeenCalled()
    expect(agent.error).toContain("attachments are not supported in remote mode")
    expect(agent.turnState).toBe("idle") // אין #setTurnState("waiting") לפני ה-return המוקדם
  })

  it("text + attachments in remote mode warns and continues with text only", async () => {
    await agent.sendPrompt("hello", {
      attachments: [{ mimeType: "image/png", dataBase64: "AA==" }],
    })

    expect(view.promptMock).toHaveBeenCalledWith("hello", undefined)
    expect(agent.error).toContain("attachments are not supported in remote mode")
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
