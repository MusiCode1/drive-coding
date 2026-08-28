/**
 * live-actions.test.ts — TDD for Commit 0: action shapes + merge.
 */

import { describe, expect, it } from "vitest"
import { buildLiveActions, LIVE_ACTION_SHAPES } from "./live-actions"
import {
  buildLiveSecretaryPrompt,
  LIVE_ACTION_PROSE,
  LIVE_SECRETARY_TOOL_ORDER,
} from "./live-prompt"

describe("LIVE_ACTION_SHAPES", () => {
  it("declares secretary + context actions (declared ⇔ handled)", () => {
    expect(LIVE_ACTION_SHAPES).toHaveLength(11)
    expect(LIVE_ACTION_SHAPES.map((s) => s.name)).toEqual([
      "compose_prompt",
      "forward",
      "cancel_turn",
      "answer_permission",
      "search_session",
      "read_recent",
      "remember_session",
      "remember_always",
      "list_config",
      "set_session_config",
      "set_app_setting",
    ])
  })
})

describe("buildLiveActions()", () => {
  it("returns all actions with merged Hebrew prose when names omitted", () => {
    const actions = buildLiveActions()
    expect(actions).toHaveLength(11)
    const compose = actions.find((a) => a.name === "compose_prompt")
    const prose = LIVE_ACTION_PROSE.compose_prompt
    expect(prose).toBeDefined()
    expect(compose?.description).toBe(prose?.description)
    expect(compose?.params[0]?.description).toBe(prose?.params.text)
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
  it("includes identifier, language, and scope sections", () => {
    const prompt = buildLiveSecretaryPrompt()
    expect(prompt).toContain("מזהים טכניים")
    expect(prompt).toContain("שפת המשתמש")
    expect(prompt).toContain("ענה בעצמך על שאלות רגילות")
    expect(prompt).toContain("compose_prompt")
  })

  it("lists every declared tool and does not invent cancel_turn undo", () => {
    expect([...LIVE_SECRETARY_TOOL_ORDER]).toEqual(LIVE_ACTION_SHAPES.map((s) => s.name))
    const prompt = buildLiveSecretaryPrompt({ tools: buildLiveActions() })
    for (const name of LIVE_SECRETARY_TOOL_ORDER) {
      expect(prompt).toContain(`${name}(`)
    }
    expect(prompt).toContain("read_recent")
    const cancel = LIVE_ACTION_PROSE.cancel_turn?.description ?? ""
    expect(cancel).toContain("רצה עכשיו")
    expect(cancel).toContain("לא מוחק קבצים")
    expect(cancel).toContain("לא מבטל תור שכבר נגמר")
    expect(prompt).toContain(cancel)
  })
})
