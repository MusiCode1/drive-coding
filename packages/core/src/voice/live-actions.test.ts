/**
 * live-actions.test.ts — TDD for Commit 0: action shapes + merge.
 */

import { describe, expect, it } from "vitest"
import { buildLiveActions, LIVE_ACTION_SHAPES } from "./live-actions"
import { buildLiveSecretaryPrompt, LIVE_ACTION_PROSE } from "./live-prompt"

describe("LIVE_ACTION_SHAPES", () => {
  it("declares exactly ten actions", () => {
    expect(LIVE_ACTION_SHAPES).toHaveLength(10)
    expect(LIVE_ACTION_SHAPES.map((s) => s.name)).toEqual([
      "compose_prompt",
      "forward",
      "cancel_turn",
      "answer_permission",
      "set_mode",
      "run_slash_command",
      "playback",
      "read_last",
      "status",
      "search_session",
    ])
  })
})

describe("buildLiveActions()", () => {
  it("returns all actions with merged Hebrew prose when names omitted", () => {
    const actions = buildLiveActions()
    expect(actions).toHaveLength(10)
    const compose = actions.find((a) => a.name === "compose_prompt")
    const prose = LIVE_ACTION_PROSE["compose_prompt"]
    expect(prose).toBeDefined()
    expect(compose?.description).toBe(prose!.description)
    expect(compose?.params[0]?.description).toBe(prose!.params.text)
  })

  it("filters to requested names and drops unknown silently", () => {
    const actions = buildLiveActions(["compose_prompt", "unknown_action", "forward"])
    expect(actions.map((a) => a.name)).toEqual(["compose_prompt", "forward"])
  })

  it("forward has no parameters", () => {
    const forward = buildLiveActions(["forward"])[0]
    expect(forward?.params).toEqual([])
  })
})

describe("buildLiveSecretaryPrompt()", () => {
  it("includes identifier, language, and no-clarify sections", () => {
    const prompt = buildLiveSecretaryPrompt()
    expect(prompt).toContain("מזהים טכניים")
    expect(prompt).toContain("שפת המשתמש")
    expect(prompt).toContain("אל תשאל שאלות הבהרה")
    expect(prompt).toContain("compose_prompt")
  })
})
