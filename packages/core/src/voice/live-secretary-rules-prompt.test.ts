import { expect, it } from "vitest"
import { checkPromptRules, LIVE_SECRETARY_RULES } from "./live-secretary-rules-prompt"

it("reports every missing rule and accepts complete sentences", () => {
  const rules = [
    { id: "one", text: "Use the tool." },
    { id: "two", text: "Acknowledge the result." },
  ]
  expect(checkPromptRules("Use the tool.\nAcknowledge the result.", rules)).toEqual([])
  expect(checkPromptRules("Use the tool.", rules)).toEqual(["two"])
  expect(checkPromptRules("", rules)).toEqual(["one", "two"])
})

it("gives each rule a unique identifier and covers every group", () => {
  expect(new Set(LIVE_SECRETARY_RULES.map(({ id }) => id)).size).toBe(LIVE_SECRETARY_RULES.length)
  expect(new Set(LIVE_SECRETARY_RULES.map(({ group }) => group))).toEqual(
    new Set(["delegation", "results", "presentation", "preferences", "identity"]),
  )
})
