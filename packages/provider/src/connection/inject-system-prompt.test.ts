/**
 * inject-system-prompt.test.ts — TDD for injectSystemPrompt (slice project-system-prompt, Commit 0).
 *
 * injectSystemPrompt: maps a generic systemPrompt string into params._meta.systemPrompt:{append}
 * — the shape the claude-agent-acp adapter (acp-agent.js:2808) reads to append to the
 * claude_code preset (verified live 2026-07-19, see brief §6).
 *
 * null/undefined/"" → no-op (params unchanged). _meta.claudeCode and other _meta keys preserved
 * (additive deep-spread, same pattern as injectModelOverride/injectEnvOverride).
 */

import { describe, expect, it } from "vitest"
import { injectSystemPrompt } from "./connect-in-process.js"

describe("injectSystemPrompt", () => {
  it('sets _meta.systemPrompt.append to the given string ("x" → append==="x")', () => {
    const params = {}
    const result = injectSystemPrompt(params, "x")
    const meta = result["_meta"] as Record<string, unknown>
    const systemPrompt = meta?.["systemPrompt"] as Record<string, unknown>
    expect(systemPrompt?.["append"]).toBe("x")
  })

  it("preserves existing _meta.claudeCode (does not overwrite)", () => {
    const params = {
      _meta: {
        claudeCode: {
          options: { model: "claude-opus-4-5" },
        },
      },
    }
    const result = injectSystemPrompt(params, "instructions here")
    const meta = result["_meta"] as Record<string, unknown>
    const claudeCode = meta?.["claudeCode"] as Record<string, unknown>
    const options = claudeCode?.["options"] as Record<string, unknown>
    expect(options?.["model"]).toBe("claude-opus-4-5")
    const systemPrompt = meta?.["systemPrompt"] as Record<string, unknown>
    expect(systemPrompt?.["append"]).toBe("instructions here")
  })

  it("preserves other existing _meta keys", () => {
    const params = {
      _meta: {
        otherKey: "preserved",
      },
    }
    const result = injectSystemPrompt(params, "x")
    const meta = result["_meta"] as Record<string, unknown>
    expect(meta?.["otherKey"]).toBe("preserved")
  })

  it("null → params unchanged (no-op, same reference)", () => {
    const params = { foo: "bar" }
    const result = injectSystemPrompt(params, null)
    expect(result).toBe(params)
  })

  it("undefined → params unchanged (no-op, same reference)", () => {
    const params = { foo: "bar" }
    const result = injectSystemPrompt(params, undefined)
    expect(result).toBe(params)
  })

  it("empty string → params unchanged (no-op, same reference)", () => {
    const params = { foo: "bar" }
    const result = injectSystemPrompt(params, "")
    expect(result).toBe(params)
  })
})
