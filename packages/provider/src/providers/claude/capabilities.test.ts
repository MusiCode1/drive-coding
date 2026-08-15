/**
 * capabilities.test.ts — unit tests for mapClaudeCapabilities (slice systemprompt-capability).
 */

import { describe, expect, it } from "vitest"
import { mapClaudeCapabilities } from "./capabilities.js"

describe("mapClaudeCapabilities", () => {
  it("systemPrompt=true — claude injects via _meta.systemPrompt.append", () => {
    const caps = mapClaudeCapabilities(null)
    expect(caps.systemPrompt).toBe(true)
  })

  it("systemPrompt=true even when agentCapabilities present", () => {
    const caps = mapClaudeCapabilities({ agentCapabilities: { mcpCapabilities: { http: true } } })
    expect(caps.systemPrompt).toBe(true)
  })
})
