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
 *   5. getQuota ext (slice session-budget-meter Commit 3) — real session →
 *      _drive/getQuota → normalized snapshot with windows. Per brief §0
 *      "ממצא חי מאומת": no raw SDK response is ever stored as a fixture (it
 *      contains behavioral analytics) — only the normalized shape is asserted.
 */

import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { listSessions } from "@anthropic-ai/claude-agent-sdk"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { InProcessHost } from "../in-process-host.js"
import { createClaudeInProcessHost } from "../in-process-host.js"

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

  // ── Case 5: getQuota ext (slice session-budget-meter Commit 3) ─────────────
  it("getQuota — real session → _drive/getQuota → normalized snapshot with windows", async () => {
    const res = await host.callExt("_drive/getQuota", { sessionId })

    // Contract: result is always { snapshot }, never a bare top-level null (brief §2/§6).
    expect(res).toHaveProperty("snapshot")
    const snapshot = (res as { snapshot: unknown }).snapshot

    // snapshot:null is a valid response (account with no visible limits) — only assert
    // shape when limits ARE available, per §0 "ממצא חי מאומת" (rate_limits_available=true
    // for this account, five_hour + seven_day present).
    if (snapshot !== null) {
      const s = snapshot as {
        provider: string
        plan?: string
        windows: Array<{
          id: string
          period: unknown
          consumption: { kind: string; usedPct?: number }
          resetsAtMs: number | null
        }>
      }
      expect(s.provider).toBe("claude")
      expect(Array.isArray(s.windows)).toBe(true)

      for (const w of s.windows) {
        // No provider ID is used to decide the label — but the *content* here
        // legitimately reads claude-specific window ids because this is the live
        // test for the claude provider itself (not generic UI code).
        expect(["five_hour", "seven_day"]).toContain(w.id)
        expect(w.consumption.kind).toBe("percentage")
        if (w.consumption.usedPct !== undefined) {
          expect(w.consumption.usedPct).toBeGreaterThanOrEqual(0)
          expect(w.consumption.usedPct).toBeLessThanOrEqual(100)
        }
        // resetsAtMs is either null or a finite epoch-ms — never NaN (brief Tests).
        expect(w.resetsAtMs === null || Number.isFinite(w.resetsAtMs)).toBe(true)
      }
    }
  }, 30_000)
})
