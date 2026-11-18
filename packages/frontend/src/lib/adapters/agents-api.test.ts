/**
 * agents-api.test.ts — TDD עבור Commit 1: withTimeout ב-createAgent / deleteAgent / notifySessionAttached.
 *
 * גישת הטסטים:
 *  - withTimeout מוcked (כמו transcribe.test.ts) כי vi.useFakeTimers ב-jsdom יוצר
 *    race condition עם unhandledRejection detection של vitest@4.1.6.
 *  - לוגיקת ה-timeout עצמה מכוסה ב-with-timeout.test.ts (core).
 *  - כאן בודקים: fetch נקרא נכון, timeout דוחה, חתימות שמורות.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@drive-coding/core/async/with-timeout", () => ({
  withTimeout: vi.fn(),
}))

vi.mock("$lib/util/be-url", () => ({
  beUrl: vi.fn((path: string) => `http://localhost:4000${path}`),
  beWsUrl: vi.fn(),
  setBeUrlBase: vi.fn(),
}))

import { withTimeout } from "@drive-coding/core/async/with-timeout"
import { createAgent, deleteAgent, getAgent, listAgents, notifySessionAttached } from "./agents-api"

const mockWithTimeout = withTimeout as ReturnType<typeof vi.fn>

// withTimeout שמפעיל את ה-fn ומחזיר תוצאתו (happy path default)
const passthroughWithTimeout = async (fn: (signal: AbortSignal) => Promise<unknown>) =>
  fn(new AbortController().signal)

beforeEach(() => {
  vi.resetAllMocks()
})

// ─── createAgent ───────────────────────────────────────────────────────────────

describe("createAgent", () => {
  it("happy path — fetch POST + returns parsed JSON", async () => {
    const fakeResponse = { agentId: "a1", status: "ready" }
    mockWithTimeout.mockImplementation(passthroughWithTimeout)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => fakeResponse,
      }),
    )

    const result = await createAgent({ cwd: "/tmp", cliKind: "opencode" })

    expect(result).toEqual(fakeResponse)
    expect(mockWithTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      10000,
      expect.objectContaining({ label: "createAgent" }),
    )
  })

  it("מחזיר תוצאה כאשר signal חיצוני מועבר (additive param)", async () => {
    const fakeResponse = { agentId: "b2", status: "ready" }
    mockWithTimeout.mockImplementation(passthroughWithTimeout)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => fakeResponse,
      }),
    )

    const ac = new AbortController()
    const result = await createAgent({ cwd: "/home", cliKind: "opencode" }, ac.signal)

    expect(result).toEqual(fakeResponse)
    // signal מועבר ל-withTimeout opts
    expect(mockWithTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      10000,
      expect.objectContaining({ signal: ac.signal }),
    )
  })

  it("timeout — withTimeout זורק → createAgent זורק", async () => {
    mockWithTimeout.mockRejectedValue(new Error("createAgent timeout 10000ms"))

    await expect(createAgent({ cwd: "/tmp", cliKind: "opencode" })).rejects.toThrow(
      "createAgent timeout 10000ms",
    )
  })

  it("שגיאת HTTP — fetch מחזיר ok=false → זורק עם status", async () => {
    mockWithTimeout.mockImplementation(passthroughWithTimeout)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "internal error",
      }),
    )

    await expect(createAgent({ cwd: "/tmp", cliKind: "opencode" })).rejects.toThrow(
      "createAgent failed: 500 internal error",
    )
  })
})

// ─── deleteAgent ───────────────────────────────────────────────────────────────

describe("deleteAgent", () => {
  it("happy path — fetch DELETE, אין return value", async () => {
    mockWithTimeout.mockImplementation(passthroughWithTimeout)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => "",
      }),
    )

    await expect(deleteAgent("agent-42")).resolves.toBeUndefined()
    expect(mockWithTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      10000,
      expect.objectContaining({ label: "deleteAgent" }),
    )
  })

  it("timeout — withTimeout זורק → deleteAgent זורק", async () => {
    mockWithTimeout.mockRejectedValue(new Error("deleteAgent timeout 10000ms"))

    await expect(deleteAgent("agent-42")).rejects.toThrow("deleteAgent timeout 10000ms")
  })
})

// ─── listAgents ────────────────────────────────────────────────────────────────

describe("listAgents", () => {
  it("happy path — GET /api/agents, returns agents array", async () => {
    const fakeAgents = [
      { id: "a1", cliKind: "opencode", cwd: "/tmp", status: "ready", createdAt: 1000 },
    ]
    mockWithTimeout.mockImplementation(passthroughWithTimeout)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ agents: fakeAgents }),
      }),
    )

    const result = await listAgents()

    expect(result).toEqual(fakeAgents)
    expect(mockWithTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      10000,
      expect.objectContaining({ label: "listAgents" }),
    )
  })

  it("HTTP שגיאה — ok=false → זורק עם status", async () => {
    mockWithTimeout.mockImplementation(passthroughWithTimeout)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      }),
    )

    await expect(listAgents()).rejects.toThrow("listAgents failed: 503")
  })

  it("timeout — withTimeout זורק → listAgents זורק", async () => {
    mockWithTimeout.mockRejectedValue(new Error("listAgents timeout 10000ms"))

    await expect(listAgents()).rejects.toThrow("listAgents timeout 10000ms")
  })

  it("מקבל signal חיצוני ומעביר אותו ל-withTimeout", async () => {
    mockWithTimeout.mockImplementation(passthroughWithTimeout)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ agents: [] }),
      }),
    )

    const ac = new AbortController()
    await listAgents(ac.signal)

    expect(mockWithTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      10000,
      expect.objectContaining({ signal: ac.signal }),
    )
  })
})

// ─── notifySessionAttached ─────────────────────────────────────────────────────
// slice agent-patch-unify C3: notifySessionAttached מאציל ל-patchAgent (PATCH /api/agents/:id)
// במקום POST …/session-attached — לכן ה-label של withTimeout הוא "patchAgent" (brief §4 C3, נמדד).

describe("notifySessionAttached", () => {
  it("happy path — PATCH דרך patchAgent, void/fire-and-forget", async () => {
    mockWithTimeout.mockImplementation(passthroughWithTimeout)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
      }),
    )

    await expect(notifySessionAttached("ag1", "sess1")).resolves.toBeUndefined()
    expect(mockWithTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      10000,
      expect.objectContaining({ label: "patchAgent" }),
    )
  })

  it("timeout — withTimeout זורק → notifySessionAttached זורק (caller אמור .catch)", async () => {
    mockWithTimeout.mockRejectedValue(new Error("patchAgent timeout 10000ms"))

    await expect(notifySessionAttached("ag1", "sess1")).rejects.toThrow(
      "patchAgent timeout 10000ms",
    )
  })
})

// ─── getAgent ──────────────────────────────────────────────────────────────────
// slice surface-real-error Commit 3: מרחיב את getAgent להחזיר crashReason (§4).

describe("getAgent", () => {
  it("happy path — status רגיל, בלי crashReason", async () => {
    mockWithTimeout.mockImplementation(passthroughWithTimeout)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ agent: { cwd: "/tmp", status: "ready" } }),
      }),
    )

    const result = await getAgent("agent-1")

    expect(result).toEqual({ agent: { cwd: "/tmp", status: "ready" } })
    expect(mockWithTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      10000,
      expect.objectContaining({ label: "getAgent" }),
    )
  })

  it("status=crashed עם crashReason — מוחזר כחלק מה-agent", async () => {
    mockWithTimeout.mockImplementation(passthroughWithTimeout)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          agent: { cwd: "/tmp", status: "crashed", crashReason: "ENOENT: binary not found" },
        }),
      }),
    )

    const result = await getAgent("agent-2")

    expect(result.agent.crashReason).toBe("ENOENT: binary not found")
    expect(result.agent.status).toBe("crashed")
  })

  it("שגיאת HTTP — ok=false → זורק עם status", async () => {
    mockWithTimeout.mockImplementation(passthroughWithTimeout)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      }),
    )

    await expect(getAgent("missing-agent")).rejects.toThrow("getAgent failed: 404")
  })

  it("מקבל signal חיצוני ומעביר אותו ל-withTimeout", async () => {
    mockWithTimeout.mockImplementation(passthroughWithTimeout)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ agent: { cwd: "/tmp", status: "ready" } }),
      }),
    )

    const ac = new AbortController()
    await getAgent("agent-3", ac.signal)

    expect(mockWithTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      10000,
      expect.objectContaining({ signal: ac.signal }),
    )
  })

  it("timeout — withTimeout זורק → getAgent זורק (Commit 4, calev §10.1)", async () => {
    mockWithTimeout.mockRejectedValue(new Error("getAgent timeout 10000ms"))

    await expect(getAgent("agent-4")).rejects.toThrow("getAgent timeout 10000ms")
  })
})
