import { createInitialSessionState, RPC_METHODS, serializeFrame } from "@drive-coding/core/session"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createDictateSubmitSourceDb } from "$lib/adapters/dictate-submit-source"
import { createFailedPromptStore } from "$lib/adapters/failed-prompt-store"
import { promptRecoveryDb } from "$lib/adapters/prompt-recovery-idb"
import { promptTestDb } from "$lib/components/chat/__tests__/type-area-harness.svelte"
import { promptOwner, promptPayload } from "$lib/engines/prompt-payload"
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
  let deletedResponse: Response | Promise<Response>
  const owner = (id: string) => promptOwner(baseUrl, "claude", id)
  const store = createFailedPromptStore(promptRecoveryDb)
  const sources = createDictateSubmitSourceDb(promptRecoveryDb)

  beforeEach(async () => {
    vi.spyOn(promptRecoveryDb, "transact").mockImplementation(promptTestDb().transact)
    vi.stubGlobal("IDBKeyRange", { bound: (lower: unknown) => ({ lower }) })
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

  afterEach(async () => {
    await view.close()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

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

  it("uses the origin namespace for a delayed delete of an inactive owner", async () => {
    const a = owner(current)
    const b = owner(other)
    const currentPrompt = await store.adopt(a, promptPayload("synthetic current"))
    const otherPrompt = await store.adopt(b, promptPayload("synthetic inactive"), {
      recordCaptureId: "inactive-record",
    })
    if (currentPrompt.kind !== "claimed" || otherPrompt.kind !== "claimed") {
      throw new Error("Missing fixture claims")
    }
    const source = await sources.save({
      owner: b, snapshot: promptPayload("synthetic Dictate"), version: 1,
      capture: { source: "dictate", id: "inactive-audio", mimeType: "audio/webm", recordingId: "", createdAt: "fixture" },
      blob: new Blob(["fixture"]),
    })
    const delayed = Promise.withResolvers<Response>()
    deletedResponse = delayed.promise
    const deletion = session.deleteSession(other)
    await vi.waitFor(() => expect(calls.at(-1)?.method).toBe(RPC_METHODS.deleteSession))
    expect(await store.load(b)).toBeDefined()
    expect(await sources.load(b)).toEqual(source)
    session._setSessionContextForTest({ sessionId: "new-active", cwd, cliKind: "other-cli" })
    delayed.resolve(Response.json({ ok: true }))
    expect(await deletion).toBe(false)
    expect(session.status).toBe("connected")
    expect(await store.load(a)).toEqual(currentPrompt.record)
    expect(await store.load(b)).toBeUndefined()
    expect(await sources.load(b)).toBeUndefined()
    expect(await store.hasRecordReceipt(b, "inactive-record")).toBe(false)
    expect(await store.settle(otherPrompt.record, { delivery: "accepted" })).toBe(false)
    await expect(sources.save(source, source.version)).rejects.toThrow("owner was deleted")
  })

  it("reports local storage failure while preserving the active ACP delete result", async () => {
    const saved = await store.adopt(owner(current), promptPayload("synthetic current"))
    if (saved.kind !== "claimed") throw new Error("Missing fixture claim")
    vi.mocked(promptRecoveryDb.transact).mockRejectedValueOnce(new Error("synthetic storage failure"))
    expect(await session.deleteSession(current)).toBe(true)
    expect(session.status).toBe("idle")
    expect(session.sessionsCache.error).toContain("Could not clear saved prompt")
    expect(await store.load(owner(current))).toEqual(saved.record)
  })

  it("retains the source and receipt unless ACP delete is confirmed", async () => {
    const key = owner(other)
    const adopted = await store.adopt(key, promptPayload("synthetic inactive"), { recordCaptureId: "record" })
    if (adopted.kind !== "claimed") throw new Error("Missing fixture claim")
    for (const response of [
      Response.json({ ok: false, unsupported: true }),
      Response.json({ error: "synthetic failure" }, { status: 502 }),
      Response.json({}),
      Response.json({ ok: false }),
    ]) {
      deletedResponse = response
      await expect(session.deleteSession(other)).resolves.toBe(false)
      expect(await store.load(key)).toEqual(adopted.record)
      expect(await store.hasRecordReceipt(key, "record")).toBe(true)
    }
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
