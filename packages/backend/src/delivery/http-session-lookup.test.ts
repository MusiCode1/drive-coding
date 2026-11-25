/**
 * GET /api/sessions/:cliKind/:sessionId — lookup cwd from session history.
 */

import { mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Hono } from "hono"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  createSessionHistoryStore,
  type SessionHistoryStore,
} from "../history/session-history-store.js"
import { registerSessionLookupHttp } from "./http-session-lookup.js"

let tmpDir: string

describe("GET /api/sessions/:cliKind/:sessionId", () => {
  beforeEach(async () => {
    tmpDir = join(tmpdir(), `dc-session-lookup-${crypto.randomUUID()}`)
    await mkdir(tmpDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  async function makeApp() {
    const app = new Hono()
    const dbFile = join(tmpDir, "history.sqlite")
    const sessionHistoryStore = await createSessionHistoryStore(dbFile)
    registerSessionLookupHttp(app, { sessionHistoryStore })
    return { app, sessionHistoryStore }
  }

  function seed(store: SessionHistoryStore, cliKind: string, acpSessionId: string, cwd: string) {
    store.recordAttach({
      agentId: "a1",
      cliKind,
      cwd,
      acpSessionId,
      now: 42_000,
    })
  }

  it("returns 200 with cwd and lastSeenAt when session exists", async () => {
    const { app, sessionHistoryStore } = await makeApp()
    seed(sessionHistoryStore, "claude", "sess-abc", "/home/proj")

    const res = await app.request("/api/sessions/claude/sess-abc")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ cwd: "/home/proj", lastSeenAt: 42_000 })
  })

  it("returns 404 when session is unknown", async () => {
    const { app } = await makeApp()
    const res = await app.request("/api/sessions/claude/no-such")
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toEqual({ error: "unknown session", code: "acp_session_not_found" })
  })
})
