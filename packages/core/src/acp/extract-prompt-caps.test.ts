/**
 * extract-prompt-caps.test.ts — TDD for extractPromptCaps (slice reattach-state-sync, Commit 1).
 *
 * extractPromptCaps(parsed) identifies an initialize **response** structurally
 * (parsed.result.agentCapabilities.promptCapabilities present — no `method` field,
 * unlike a notification) and returns the full promptCapabilities object (§9 Q3:
 * store all of it, not just `image` — future fields like audio/embeddedContext ride
 * the same path). Returns undefined for anything that isn't an init-response frame.
 */
import { describe, expect, it } from "vitest"
import { extractPromptCaps } from "./extract-prompt-caps.js"

describe("extractPromptCaps", () => {
  it("init result-frame with promptCapabilities.image:true -> returns promptCapabilities with image:true", () => {
    const parsed = {
      jsonrpc: "2.0",
      id: 1,
      result: {
        agentCapabilities: {
          promptCapabilities: { image: true, audio: false },
        },
      },
    }
    expect(extractPromptCaps(parsed)).toEqual({ image: true, audio: false })
  })

  it("init result-frame with promptCapabilities.image:false -> returns promptCapabilities with image:false", () => {
    const parsed = {
      jsonrpc: "2.0",
      id: 1,
      result: { agentCapabilities: { promptCapabilities: { image: false } } },
    }
    expect(extractPromptCaps(parsed)).toEqual({ image: false })
  })

  it("result-frame with promptCapabilities missing `image` key -> still returns the object (image undefined)", () => {
    const parsed = {
      jsonrpc: "2.0",
      id: 1,
      result: { agentCapabilities: { promptCapabilities: { audio: true } } },
    }
    expect(extractPromptCaps(parsed)).toEqual({ audio: true })
  })

  it("result-frame without agentCapabilities -> undefined (not an init frame)", () => {
    const parsed = { jsonrpc: "2.0", id: 1, result: { ok: true } }
    expect(extractPromptCaps(parsed)).toBeUndefined()
  })

  it("result-frame with agentCapabilities but no promptCapabilities -> undefined", () => {
    const parsed = { jsonrpc: "2.0", id: 1, result: { agentCapabilities: { mcpCapabilities: {} } } }
    expect(extractPromptCaps(parsed)).toBeUndefined()
  })

  it("notification frame (has method, no result) -> undefined, even if it happens to carry a `result`-shaped params", () => {
    const parsed = {
      jsonrpc: "2.0",
      method: "session/update",
      params: { update: { sessionUpdate: "agent_message_chunk" } },
    }
    expect(extractPromptCaps(parsed)).toBeUndefined()
  })

  it("error response frame -> undefined", () => {
    const parsed = { jsonrpc: "2.0", id: 1, error: { code: -32600, message: "bad" } }
    expect(extractPromptCaps(parsed)).toBeUndefined()
  })

  it("non-object input -> undefined, no throw", () => {
    expect(extractPromptCaps(null)).toBeUndefined()
    expect(extractPromptCaps(undefined)).toBeUndefined()
    expect(extractPromptCaps("not an object")).toBeUndefined()
    expect(extractPromptCaps(42)).toBeUndefined()
  })
})
