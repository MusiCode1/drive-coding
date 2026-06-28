/**
 * host.live.test.ts — permanent live test suite: real client → real claude CLI.
 *
 * Gated behind RUN_LIVE=1. The file is collected by pnpm test (no exclude in vitest.config),
 * but describe.skipIf ensures it is skipped unless the env var is set.
 *
 * IMPORTANT: top-level code must be lazy / non-side-effecting.
 * No host initialization at module level — only inside describe/beforeAll.
 *
 * Cases:
 *   1. capabilities — start() returns thinkingTokens=true + rename=true
 *   2. deterministic round-trip — real claude responds with DRIVE_OK_4242
 *   3. setThinkingTokens ext — callExt returns {ok:true}, prompt after succeeds
 *   4. rename — rename(sessionId, "DC-TEST") reflected in listSessions
 */

import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { listSessions } from "@anthropic-ai/claude-agent-sdk"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { InProcessHost } from "../host.js"
import { createClaudeInProcessHost } from "../host.js"

const RUN = process.env.RUN_LIVE === "1"

describe.skipIf(!RUN)("in-process host — live (real client → real claude CLI)", () => {
  let host: InProcessHost
  let cwd: string
  let sessionId: string

  beforeAll(async () => {
    // Use a temp directory as cwd so sessions are isolated from the repo
    cwd = await mkdtemp(join(tmpdir(), "drive-coding-live-"))
    host = createClaudeInProcessHost()
    await host.start({ cwd })
  }, 30_000)

  afterAll(async () => {
    await host.close()
  }, 15_000)

  // ── Case 1: capabilities ──────────────────────────────────────────────────
  it("capabilities — thinkingTokens=true + rename=true after start()", async () => {
    // Re-create host to get a fresh capabilities read (afterAll closes)
    // Actually we already have caps from beforeAll start() — but start() returns them.
    // Re-start a fresh host for this assertion to be self-contained:
    const h2 = createClaudeInProcessHost()
    const { capabilities } = await h2.start({ cwd })
    try {
      expect(capabilities.thinkingTokens).toBe(true)
      expect(capabilities.rename).toBe(true)
      // mcp is expected true per existing tests
      expect(capabilities.mcp).toBe(true)
    } finally {
      await h2.close()
    }
  }, 30_000)

  // ── Case 2: deterministic round-trip ─────────────────────────────────────
  it("deterministic round-trip — claude responds with DRIVE_OK_4242", async () => {
    const { sessionId: sid } = await host.newSession({ cwd })
    sessionId = sid // reuse for later cases

    const chunks: string[] = []
    await host.prompt(
      { sessionId: sid, text: "Reply with EXACTLY this token and nothing else: DRIVE_OK_4242" },
      (update) => {
        const u = update as { sessionUpdate?: string; content?: { text?: string } }
        if (u.sessionUpdate === "agent_message_chunk" && u.content?.text) {
          chunks.push(u.content.text)
        }
      },
    )

    const joined = chunks.join("").trim()
    expect(joined).toContain("DRIVE_OK_4242")
  }, 60_000)

  // ── Case 3: setThinkingTokens ext ────────────────────────────────────────
  it("setThinkingTokens — callExt returns {ok:true} + prompt after succeeds", async () => {
    // sessionId is set from case 2 (same session)
    const res = await host.callExt("_drive/setThinkingTokens", {
      sessionId,
      n: 8000,
    })
    expect(res).toEqual({ ok: true })

    // Follow-up prompt proves the query is not broken after setThinkingTokens
    const chunks: string[] = []
    await host.prompt(
      {
        sessionId,
        text: "Reply with EXACTLY this token and nothing else: DRIVE_OK_4242",
      },
      (update) => {
        const u = update as { sessionUpdate?: string; content?: { text?: string } }
        if (u.sessionUpdate === "agent_message_chunk" && u.content?.text) {
          chunks.push(u.content.text)
        }
      },
    )

    const joined = chunks.join("").trim()
    expect(joined).toContain("DRIVE_OK_4242")
  }, 90_000)

  // ── Case 4: rename ────────────────────────────────────────────────────────
  it("rename — sessionId renamed to DC-TEST, visible in listSessions", async () => {
    const RENAME_TITLE = "DC-TEST"

    await host.rename(sessionId, RENAME_TITLE)

    // Verify via listSessions (dir-scoped first, then search-all)
    let sessions = await listSessions({ dir: cwd })
    let found = sessions.find((s) => s.sessionId === sessionId)

    if (!found) {
      sessions = await listSessions()
      found = sessions.find((s) => s.sessionId === sessionId)
    }

    expect(found).toBeDefined()
    const effectiveTitle = found?.customTitle ?? found?.summary
    expect(effectiveTitle).toBe(RENAME_TITLE)
  }, 30_000)
})
