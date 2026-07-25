/**
 * capabilities-static.test.ts — unit tests for staticCapsFor (commit 2).
 *
 * Tests:
 *   - staticCapsFor("codex"): mcp:true, thinkingTokens:false, rename:false
 *   - staticCapsFor("opencode"): all false (regression guard)
 *   - staticCapsFor("claude"): all false (regression guard)
 *   - staticCapsFor returns NormalizedCapabilities shape for all known kinds
 */

import { describe, expect, it } from "vitest"
import { staticCapsFor } from "./capabilities-static.js"

describe("staticCapsFor", () => {
  it("codex: mcp=true, thinkingTokens=false, rename=false", () => {
    const caps = staticCapsFor("codex")
    expect(caps.mcp).toBe(true)
    expect(caps.thinkingTokens).toBe(false)
    expect(caps.rename).toBe(false)
  })

  it("codex: compact/commands/usage/configOptions all false", () => {
    const caps = staticCapsFor("codex")
    expect(caps.compact).toBe(false)
    expect(caps.commands).toBe(false)
    expect(caps.usage).toBe(false)
    expect(caps.configOptions).toBe(false)
  })

  it("opencode: all false (regression guard)", () => {
    const caps = staticCapsFor("opencode")
    expect(caps.mcp).toBe(false)
    expect(caps.thinkingTokens).toBe(false)
    expect(caps.rename).toBe(false)
  })

  it("claude (spawn fallback): all false (regression guard)", () => {
    const caps = staticCapsFor("claude")
    expect(caps.mcp).toBe(false)
    expect(caps.thinkingTokens).toBe(false)
    expect(caps.rename).toBe(false)
  })

  // slice-cursor-acp commit 0: cursor + grok both measured mcp:true (http+sse) — ר' brief §-1.
  it("cursor: mcp=true, rest false (measured http+sse)", () => {
    const caps = staticCapsFor("cursor")
    expect(caps.mcp).toBe(true)
    expect(caps.compact).toBe(false)
    expect(caps.commands).toBe(false)
    expect(caps.usage).toBe(false)
    expect(caps.configOptions).toBe(false)
    expect(caps.rename).toBe(false)
    expect(caps.thinkingTokens).toBe(false)
  })

  it("grok: mcp=true, rest false (measured http+sse)", () => {
    const caps = staticCapsFor("grok")
    expect(caps.mcp).toBe(true)
    expect(caps.compact).toBe(false)
    expect(caps.commands).toBe(false)
    expect(caps.usage).toBe(false)
    expect(caps.configOptions).toBe(false)
    expect(caps.rename).toBe(false)
    expect(caps.thinkingTokens).toBe(false)
  })
})
