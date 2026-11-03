/**
 * session-screen.test.ts — the resume offer, and the silence of its fail-open path.
 *
 * AGENTS.md: a fail-open path is not implemented until its silent branches are asserted.
 * The happy path was never the risk here — a broken history lookup that quietly turns
 * the not-found screen into an error screen is.
 */

import { describe, expect, it, vi } from "vitest"
import type { SessionHistoryRow } from "$lib/adapters/session-history-api"
import { resolveSessionScreen } from "./session-screen.js"

const openSessionUrlMock = vi.fn()
const fetchRowMock = vi.fn<() => Promise<SessionHistoryRow | undefined>>()

vi.mock("$lib/actions/open-session-url", () => ({
  openSessionUrl: (...args: unknown[]) => openSessionUrlMock(...args),
}))

vi.mock("$lib/adapters/session-history-api", () => ({
  fetchSessionHistoryRow: () => fetchRowMock(),
}))

const row: SessionHistoryRow = {
  cliKind: "claude",
  acpSessionId: "sess-1",
  cwd: "/home/u/proj",
  lastSeenAt: 7,
  turns: 2,
}

function call() {
  return resolveSessionScreen({
    cliKind: "claude",
    sessionId: "sess-1",
    session: {} as never,
    settings: {} as never,
  })
}

describe("resolveSessionScreen", () => {
  it("not-found plus a history row → offer resume", async () => {
    openSessionUrlMock.mockResolvedValue("not-found")
    fetchRowMock.mockResolvedValue(row)

    expect(await call()).toEqual({ outcome: "not-found", resumable: row })
  })

  it("not-found with no row → no offer", async () => {
    openSessionUrlMock.mockResolvedValue("not-found")
    fetchRowMock.mockResolvedValue(undefined)

    expect(await call()).toEqual({ outcome: "not-found", resumable: null })
  })

  it("a thrown lookup stays not-found with no offer — it must not become an error", async () => {
    openSessionUrlMock.mockResolvedValue("not-found")
    fetchRowMock.mockRejectedValue(new Error("history store down"))

    expect(await call()).toEqual({ outcome: "not-found", resumable: null })
  })

  it("connected never queries history", async () => {
    openSessionUrlMock.mockResolvedValue("connected")
    fetchRowMock.mockReset()

    expect(await call()).toEqual({ outcome: "connected", resumable: null })
    expect(fetchRowMock).not.toHaveBeenCalled()
  })

  it("needs-takeover never queries history — resume is not offered over a live host", async () => {
    openSessionUrlMock.mockResolvedValue("needs-takeover")
    fetchRowMock.mockReset()

    expect(await call()).toEqual({ outcome: "needs-takeover", resumable: null })
    expect(fetchRowMock).not.toHaveBeenCalled()
  })

  it("error never queries history", async () => {
    openSessionUrlMock.mockResolvedValue("error")
    fetchRowMock.mockReset()

    expect(await call()).toEqual({ outcome: "error", resumable: null })
    expect(fetchRowMock).not.toHaveBeenCalled()
  })
})
