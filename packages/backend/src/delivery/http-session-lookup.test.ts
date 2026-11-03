/**
 * http-session-lookup.test.ts — GET /api/sessions/:cliKind/:acpSessionId.
 *
 * Both branches are asserted: a row answers 200, and a missing row answers 404 rather
 * than an empty 200. The distinction is what lets the FE tell "cannot resume" from
 * "nothing to resume".
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Hono } from "hono"
import { afterEach, describe, expect, it } from "vitest"
import {
  createSessionHistoryStore,
  sessionHistoryDbPath,
} from "../history/session-history-store.js"
import { registerSessionLookupRoute } from "./http-session-lookup.js"

describe("GET /api/sessions/:cliKind/:acpSessionId", () => {
  let dir: string

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  async function appWithSession() {
    dir = mkdtempSync(join(tmpdir(), "dc-http-sesslookup-"))
    const store = await createSessionHistoryStore(sessionHistoryDbPath(dir))
    store.recordAttach({
      agentId: "a1",
      cliKind: "claude",
      cwd: "/home/u/proj",
      acpSessionId: "sess-1",
      now: 1_700_000_000_000,
    })
    const app = new Hono()
    registerSessionLookupRoute(app, store)
    return { app, store }
  }

  it("returns the row with its cwd for a known session", async () => {
    const { app, store } = await appWithSession()

    const res = await app.request("/api/sessions/claude/sess-1")

    expect(res.status).toBe(200)
    const body = (await res.json()) as { session: { cwd: string; acpSessionId: string } }
    expect(body.session.acpSessionId).toBe("sess-1")
    expect(body.session.cwd).toBe("/home/u/proj")
    store.close()
  })

  it("answers 404 for a session with no row — not an empty 200", async () => {
    const { app, store } = await appWithSession()

    const res = await app.request("/api/sessions/claude/never-hosted")

    expect(res.status).toBe(404)
    store.close()
  })

  it("does not match a known session id under a different cliKind", async () => {
    const { app, store } = await appWithSession()

    const res = await app.request("/api/sessions/codex/sess-1")

    expect(res.status).toBe(404)
    store.close()
  })

  it("percent-encoded session ids resolve to the decoded id", async () => {
    dir = mkdtempSync(join(tmpdir(), "dc-http-sesslookup-enc-"))
    const store = await createSessionHistoryStore(sessionHistoryDbPath(dir))
    store.recordAttach({
      agentId: "a1",
      cliKind: "claude",
      cwd: "/home/u/proj",
      acpSessionId: "with/slash",
      now: 5,
    })
    const app = new Hono()
    registerSessionLookupRoute(app, store)

    const res = await app.request(`/api/sessions/claude/${encodeURIComponent("with/slash")}`)

    expect(res.status).toBe(200)
    store.close()
  })
})
