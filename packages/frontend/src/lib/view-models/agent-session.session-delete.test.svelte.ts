import { createInitialSessionState, RPC_METHODS, serializeFrame } from "@drive-coding/core/session"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createRemoteSessionView } from "$lib/session/create-session-view"
import { metaSnapshotFrame, withHistoryTail } from "./__fixtures__/meta-history-fetch"
import { AgentSession } from "./agent-session.svelte"

const current = "current-session"
const other = "other-session"
const cwd = "/project"
const hostState = createInitialSessionState({ sessionId: current })
const snapshot = serializeFrame(metaSnapshotFrame(hostState))
const baseUrl = "http://be.local"

describe("session deletion through the backend session view", () => {
  let view: ReturnType<typeof createRemoteSessionView>
  let session: AgentSession
  let supportsDelete: boolean
  let appendResponse: Promise<Response> | undefined
  const calls: { method: string; params?: unknown }[] = []
  let deletedResponse: Response

  beforeEach(async () => {
    supportsDelete = true
    appendResponse = undefined
    deletedResponse = Response.json({ ok: true })
    calls.length = 0
    view = createRemoteSessionView("test-agent", baseUrl, {
      _fetch: withHistoryTail(baseUrl, hostState, async (url, init) => {
        const path = new URL(url, baseUrl).pathname
        if (path.endsWith("/events")) {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode(snapshot))
              },
            }),
          )
        }
        const rpc = JSON.parse(String(init?.body)) as (typeof calls)[number]
        calls.push(rpc)
        if (rpc.method === RPC_METHODS.listSessions) {
          if (appendResponse && (rpc.params as { cursor?: string })?.cursor !== undefined) {
            return appendResponse
          }
          return Response.json({
            sessions: [
              { sessionId: current, cwd },
              { sessionId: other, cwd },
            ],
            capabilities: { list: true, filterByCwd: true, delete: supportsDelete },
            nextCursor: "append",
          })
        }
        if (rpc.method === RPC_METHODS.deleteSession) return deletedResponse
        throw new Error(`Unexpected test host path: ${url}`)
      }),
    })
    await view.connect()
    session = new AgentSession({ view })
    session._setStatusForTest("connected")
    session._setSessionContextForTest({ sessionId: current, cwd, cliKind: "claude" })
  })

  afterEach(() => view.close())

  it("hides the delete capability until the first list response", async () => {
    expect(new AgentSession().supportsSessionDelete).toBe(false)
    expect(session.supportsSessionDelete).toBe(false)
    await session.listSessions()
    expect(session.supportsSessionDelete).toBe(true)
  })

  it("hides deletion when the page has no delete capability", async () => {
    supportsDelete = false
    await session.listSessions()
    expect(session.supportsSessionDelete).toBe(false)
  })

  it("does not send a delete when no view is attached", async () => {
    await expect(new AgentSession().deleteSession(other)).resolves.toBe(false)
    expect(calls).toEqual([])
  })

  it("removes a deleted inactive session and keeps the current view", async () => {
    await session.listSessions()
    await expect(session.deleteSession(other)).resolves.toBe(false)
    expect(calls.at(-1)).toEqual({
      method: RPC_METHODS.deleteSession,
      params: { sessionId: other },
    })
    expect(session.sessionsCache.sessions.items.map((item) => item.sessionId)).toEqual([current])
    expect(session.status).toBe("connected")
  })

  it("clears the view and returns true when deleting the active session", async () => {
    await session.listSessions()
    await expect(session.deleteSession(current)).resolves.toBe(true)
    expect(calls.at(-1)).toEqual({
      method: RPC_METHODS.deleteSession,
      params: { sessionId: current },
    })
    expect(session.sessionsCache.sessions.items).toEqual([])
    expect(session.status).toBe("idle")
  })

  it("leaves the list and error state intact when deletion is unsupported", async () => {
    await session.listSessions()
    deletedResponse = Response.json({ ok: false, unsupported: true })
    await expect(session.deleteSession(other)).resolves.toBe(false)
    expect(session.sessionsCache.error).toBeNull()
    expect(session.sessionsCache.sessions.items.map((item) => item.sessionId)).toEqual([
      current,
      other,
    ])
  })

  it("an unsupported delete stays hidden after a positive append and refresh", async () => {
    await session.listSessions(false, { cwd })
    const pending = Promise.withResolvers<Response>()
    appendResponse = pending.promise
    const append = session.loadMoreSessions()
    deletedResponse = Response.json({ ok: false, unsupported: true })
    await expect(session.deleteSession(other)).resolves.toBe(false)
    expect(session.supportsSessionDelete).toBe(false)
    pending.resolve(
      Response.json({
        sessions: [{ sessionId: "next", cwd }],
        capabilities: { list: true, filterByCwd: true, delete: true },
      }),
    )
    await append
    expect(session.sessionsCache.sessions.items.map((item) => item.sessionId)).toEqual([
      current,
      other,
      "next",
    ])
    expect(session.supportsSessionDelete).toBe(false)
    await session.listSessions(true, { cwd })
    expect(session.supportsSessionDelete).toBe(false)
    expect(
      calls.filter(({ method }) => method === RPC_METHODS.listSessions).map(({ params }) => params),
    ).toEqual([
      { paged: true, cwd },
      { paged: true, cwd, cursor: "append" },
      { paged: true, cwd },
    ])
  })

  it("surfaces other deletion failures in the sessions cache", async () => {
    await session.listSessions()
    deletedResponse = Response.json({ error: "boom" }, { status: 502 })
    await expect(session.deleteSession(other)).resolves.toBe(false)
    expect(session.sessionsCache.error).toContain("boom")
  })
})
