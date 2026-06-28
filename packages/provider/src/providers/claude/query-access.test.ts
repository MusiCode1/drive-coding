/**
 * query-access.test.ts — unit tests for getQuery (TDD red→green).
 *
 * Testing against a stub-agent with a sessions map containing a query object.
 * No real claude required — just structural/contract tests.
 */

import type { ClaudeAcpAgent } from "@agentclientprotocol/claude-agent-acp"
import { describe, expect, it, vi } from "vitest"
import { getQuery } from "./query-access.js"

describe("getQuery — accessor for live query object", () => {
  it("returns the query object for a known sessionId", () => {
    const setMaxThinkingTokens = vi.fn()
    const stubAgent = {
      sessions: {
        "session-1": { query: { setMaxThinkingTokens } },
      },
    } as unknown as ClaudeAcpAgent

    const query = getQuery(stubAgent, "session-1")
    expect(query.setMaxThinkingTokens).toBe(setMaxThinkingTokens)
  })

  it("throws a descriptive error for an unknown sessionId", () => {
    const stubAgent = {
      sessions: {
        "session-1": { query: { setMaxThinkingTokens: vi.fn() } },
      },
    } as unknown as ClaudeAcpAgent

    expect(() => getQuery(stubAgent, "no-such-session")).toThrow(
      "getQuery: no live query for session no-such-session",
    )
  })

  it("throws when sessions map is empty", () => {
    const stubAgent = {
      sessions: {},
    } as unknown as ClaudeAcpAgent

    expect(() => getQuery(stubAgent, "missing")).toThrow(
      "getQuery: no live query for session missing",
    )
  })

  it("throws when query is missing from the session record", () => {
    const stubAgent = {
      sessions: {
        "session-1": {},
      },
    } as unknown as ClaudeAcpAgent

    expect(() => getQuery(stubAgent, "session-1")).toThrow(
      "getQuery: no live query for session session-1",
    )
  })

  it("delegates setMaxThinkingTokens call with correct args", async () => {
    const setMaxThinkingTokens = vi.fn().mockResolvedValue(undefined)
    const stubAgent = {
      sessions: {
        s1: { query: { setMaxThinkingTokens } },
      },
    } as unknown as ClaudeAcpAgent

    const query = getQuery(stubAgent, "s1")
    await query.setMaxThinkingTokens(8000)
    expect(setMaxThinkingTokens).toHaveBeenCalledWith(8000)
  })
})
