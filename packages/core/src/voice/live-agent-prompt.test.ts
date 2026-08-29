/**
 * live-agent-prompt.test.ts — secretary→agent marker and prompt.
 *
 * Slice: agent-secretary-prompt, Commit 0.
 */

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  buildLiveAgentPrompt,
  conversationHasLiveAgentPreamble,
  formatSecretaryDispatch,
  formatSecretaryToAgent,
  LIVE_SECRETARY_TO_AGENT_MARKER,
} from "./live-agent-prompt"

describe("formatSecretaryToAgent", () => {
  it("prefixes text with the exported marker constant", () => {
    expect(formatSecretaryToAgent("fix auth.ts")).toBe(
      `${LIVE_SECRETARY_TO_AGENT_MARKER} fix auth.ts`,
    )
  })
})

describe("buildLiveAgentPrompt", () => {
  it("includes the exported marker constant (not a duplicate inline tag)", () => {
    const prompt = buildLiveAgentPrompt()
    expect(prompt).toContain(LIVE_SECRETARY_TO_AGENT_MARKER)
    const markerCount = prompt.split(LIVE_SECRETARY_TO_AGENT_MARKER).length - 1
    expect(markerCount).toBe(1)
  })

  it("explains secretary-tagged messages and driving context", () => {
    const prompt = buildLiveAgentPrompt()
    expect(prompt).toContain("מזכיר קולי")
    expect(prompt).toContain("בלי טבלאות")
    expect(prompt).toContain("תמלול")
  })

  it("does not import or duplicate secretary prompt content", () => {
    const dir = dirname(fileURLToPath(import.meta.url))
    const agentSource = readFileSync(join(dir, "live-agent-prompt.ts"), "utf8")
    expect(agentSource).not.toContain("buildLiveSecretaryPrompt")
    expect(agentSource).not.toContain("LIVE_AGENT_DELIVERY_MARKER")
    expect(buildLiveAgentPrompt()).not.toContain("[תשובת-סוכן]")
  })
})

describe("formatSecretaryDispatch", () => {
  it("tags only when preamble is omitted", () => {
    expect(formatSecretaryDispatch("fix auth.ts")).toBe(formatSecretaryToAgent("fix auth.ts"))
  })

  it("prepends the one-shot instruction before the first tagged body", () => {
    const out = formatSecretaryDispatch("fix auth.ts", { includePreamble: true })
    expect(out.startsWith(`${buildLiveAgentPrompt()}\n\n`)).toBe(true)
    expect(out.endsWith(formatSecretaryToAgent("fix auth.ts"))).toBe(true)
  })
})

describe("conversationHasLiveAgentPreamble", () => {
  it("is false when the conversation is empty", () => {
    expect(conversationHasLiveAgentPreamble([])).toBe(false)
    expect(conversationHasLiveAgentPreamble(["hello", "[מזכיר] what time?"])).toBe(false)
  })

  it("is true when any text contains the full explanation", () => {
    const sent = formatSecretaryDispatch("מה השעה?", { includePreamble: true })
    expect(conversationHasLiveAgentPreamble(["earlier", sent])).toBe(true)
  })
})
