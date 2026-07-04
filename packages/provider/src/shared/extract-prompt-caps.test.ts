/**
 * extract-prompt-caps.test.ts — TDD tests for extractPromptCaps (Commit 1, reattach-state-sync).
 *
 * extractPromptCaps(parsed) extracts { image: boolean } from an ACP initialize response frame.
 * Identification: responseKind==="result" AND parsed.result?.agentCapabilities?.promptCapabilities exists.
 * Returns undefined for notifications (method present), error frames, or missing agentCapabilities.
 *
 * Tests (Red first per TDD):
 *   1. init result with promptCapabilities.image:true → { image: true }
 *   2. init result with promptCapabilities.image:false → { image: false }
 *   3. init result with promptCapabilities.image missing → { image: false } (safe default)
 *   4. init result without agentCapabilities → undefined (not an init-response)
 *   5. notification frame (method present) → undefined (not a result)
 *   6. error frame → undefined
 *   7. raw parsed object (not yet decoded) — verify structural detection
 */

import { describe, expect, it } from "vitest"
import { extractPromptCaps } from "./extract-prompt-caps.js"

/** Build a JSON-RPC result frame parsed object (as from decodeWireLine) */
function makeInitResult(agentCapabilities: Record<string, unknown>): unknown {
  return {
    jsonrpc: "2.0",
    id: 1,
    result: {
      protocolVersion: 1,
      serverInfo: { name: "claude-agent", version: "0.0.0" },
      agentCapabilities,
    },
  }
}

describe("extractPromptCaps", () => {
  it("returns { image: true } for init result with promptCapabilities.image:true", () => {
    const parsed = makeInitResult({
      promptCapabilities: { image: true, audio: false },
      mcpCapabilities: {},
    })
    const result = extractPromptCaps(parsed)
    expect(result).toEqual({ image: true })
  })

  it("returns { image: false } for init result with promptCapabilities.image:false", () => {
    const parsed = makeInitResult({
      promptCapabilities: { image: false },
    })
    const result = extractPromptCaps(parsed)
    expect(result).toEqual({ image: false })
  })

  it("returns { image: false } for init result with promptCapabilities present but image missing", () => {
    const parsed = makeInitResult({
      promptCapabilities: { audio: true },
    })
    const result = extractPromptCaps(parsed)
    expect(result).toEqual({ image: false })
  })

  it("returns undefined for init result without agentCapabilities", () => {
    const parsed = {
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: 1,
        serverInfo: { name: "some-agent", version: "0.0.0" },
        // no agentCapabilities — not a full initialize response
      },
    }
    const result = extractPromptCaps(parsed)
    expect(result).toBeUndefined()
  })

  it("returns undefined for a notification frame (method present, not a result)", () => {
    const parsed = {
      jsonrpc: "2.0",
      method: "session/update",
      params: { update: { sessionUpdate: "agent_message_chunk" } },
    }
    const result = extractPromptCaps(parsed)
    expect(result).toBeUndefined()
  })

  it("returns undefined for an error frame", () => {
    const parsed = {
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32600, message: "invalid" },
    }
    const result = extractPromptCaps(parsed)
    expect(result).toBeUndefined()
  })

  it("returns undefined for null input", () => {
    expect(extractPromptCaps(null)).toBeUndefined()
  })

  it("returns undefined for undefined input", () => {
    expect(extractPromptCaps(undefined)).toBeUndefined()
  })

  it("returns undefined for a non-object (number)", () => {
    expect(extractPromptCaps(42)).toBeUndefined()
  })
})
