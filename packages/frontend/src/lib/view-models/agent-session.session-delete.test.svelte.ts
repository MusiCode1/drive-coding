import {
  createInitialSessionState,
  RPC_METHODS,
  serializeFrame,
  snapshotFrame,
} from "@drive-coding/core/session"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createRemoteSessionView } from "$lib/session/create-session-view"
import { AgentSession } from "./agent-session.svelte"

const current = "current-session"
const other = "other-session"
const cwd = "/project"
const snapshot = serializeFrame(snapshotFrame(createInitialSessionState({ sessionId: current })))

describe("session deletion through the backend session view", () => {
  let view: ReturnType<typeof createRemoteSessionView>
  let session: AgentSession
  let capabilities: unknown
  const calls: { method: string; params?: unknown }[] = []
  let deletedResponse: Response

  beforeEach(async () => {
    capabilities = { delete: {} }
    deletedResponse = Response.json({ ok: true })
    calls.length = 0
    view = createRemoteSessionView("test-agent", "http://be.local", {
      _fetch: async (url, init) => {
        if (url.endsWith("/events")) {
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
          return Response.json({
            sessions: [
              { sessionId: current, cwd },
              { sessionId: other, cwd },
            ],
            sessionCapabilities: capabilities,
          })
        }
        if (rpc.method === RPC_METHODS.deleteSession) return deletedResponse
        throw new Error("Unexpected test host path")
      },
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

  it.each([{ list: {} }, undefined])(
    "hides deletion when listSessions returns %j",
    async (advertised) => {
      capabilities = advertised
      await session.listSessions()
      expect(session.supportsSessionDelete).toBe(false)
    },
  )

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
    expect(session.sessionsCache.sessions.map((item) => item.sessionId)).toEqual([current])
    expect(session.status).toBe("connected")
  })

  it("clears the view and returns true when deleting the active session", async () => {
    await session.listSessions()
    await expect(session.deleteSession(current)).resolves.toBe(true)
    expect(calls.at(-1)).toEqual({
      method: RPC_METHODS.deleteSession,
      params: { sessionId: current },
    })
    expect(session.sessionsCache.sessions).toEqual([])
    expect(session.status).toBe("idle")
  })

  it("leaves the list and error state intact when deletion is unsupported", async () => {
    await session.listSessions()
    deletedResponse = Response.json({ ok: false, unsupported: true })
    await expect(session.deleteSession(other)).resolves.toBe(false)
    expect(session.sessionsCache.error).toBeNull()
    expect(session.sessionsCache.sessions.map((item) => item.sessionId)).toEqual([current, other])
  })

  it("surfaces other deletion failures in the sessions cache", async () => {
    await session.listSessions()
    deletedResponse = Response.json({ error: "boom" }, { status: 502 })
    await expect(session.deleteSession(other)).resolves.toBe(false)
    expect(session.sessionsCache.error).toContain("boom")
  })
})
