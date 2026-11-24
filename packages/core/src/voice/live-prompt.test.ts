/**
 * live-prompt.test.ts — delivery markers and system-prompt sections.
 *
 * Slice: live-secretary fix1, Commit A+B.
 */

import { describe, expect, it } from "vitest"
import { buildLiveActions } from "./live-actions"
import {
  buildLiveSecretaryPrompt,
  formatAgentDelivery,
  formatPermissionPending,
  LIVE_AGENT_DELIVERY_MARKER,
  LIVE_PERMISSION_PENDING_MARKER,
} from "./live-prompt"
import { checkPromptRules, LIVE_SECRETARY_RULES } from "./live-secretary-rules-prompt"

describe("formatAgentDelivery", () => {
  it("prefixes agent answer with the exported marker constant", () => {
    expect(formatAgentDelivery("auth.test.ts passed")).toBe(
      `${LIVE_AGENT_DELIVERY_MARKER} auth.test.ts passed`,
    )
  })
})

describe("formatPermissionPending", () => {
  it("includes marker, tool title, and option list", () => {
    const text = formatPermissionPending({
      toolTitle: "Run command",
      options: [
        { optionId: "allow-1", name: "Allow once" },
        { optionId: "deny-1", name: "Deny" },
      ],
    })
    expect(text.startsWith(LIVE_PERMISSION_PENDING_MARKER)).toBe(true)
    expect(text).toContain("Run command")
    expect(text).toContain("allow-1: Allow once")
    expect(text).toContain("deny-1: Deny")
  })
})

describe("buildLiveSecretaryPrompt", () => {
  it("includes agent-delivery and permission sections referencing exported markers", () => {
    const prompt = buildLiveSecretaryPrompt()
    expect(prompt).toContain(LIVE_AGENT_DELIVERY_MARKER)
    expect(prompt).toContain("אל תשגר אותו מחדש לסוכן ב-compose_prompt")
    expect(prompt).toContain(LIVE_PERMISSION_PENDING_MARKER)
    expect(prompt).toContain("answer_permission")
    expect(prompt).toContain("read_recent")
    expect(prompt).toContain("pause_live")
    expect(prompt).toContain("close_live")
    expect(prompt).toContain("חידוש אחרי השהיה")
    expect(prompt).toContain("thoughts=true")
    expect(prompt).toContain("toolCalls=true")
    expect(prompt).toContain("כלים — זה מה שכל כלי עושה באמת")
  })
})

const FORBIDDEN_HIDING = [
  "אל תזכיר את הסוכן",
  "אל תזכיר את סוכן הקוד",
  "אל תגלה שיש סוכן",
  "כאילו אתה עשית",
  "הצג את העבודה כשלך",
  "מערכת אחת",
  "backend",
] as const

function hidingPhrases(prompt: string): string[] {
  return FORBIDDEN_HIDING.filter((phrase) => prompt.toLowerCase().includes(phrase))
}

describe("secretary role policy", () => {
  it("includes every rule and explicitly attributes the work to the coding agent", () => {
    const required = [
      "delegate-default",
      "no-result-before-delivery",
      "no-refusal",
      "no-tables",
      "agent-is-named",
    ]
    const ids = LIVE_SECRETARY_RULES.map((rule) => rule.id)
    for (const id of required) expect(ids).toContain(id)
    for (const prompt of [
      buildLiveSecretaryPrompt(),
      buildLiveSecretaryPrompt({ language: "he", tools: buildLiveActions() }),
    ]) {
      expect(hidingPhrases(prompt)).toEqual([])
      expect(checkPromptRules(prompt, LIVE_SECRETARY_RULES)).toEqual([])
      for (const id of ids) expect(prompt).not.toContain(id)
      expect(prompt).toContain("סוכן הקוד מבצע את העבודה")
    }
  })

  it.each(FORBIDDEN_HIDING)("detects prohibited phrasing: %s", (phrase) => {
    expect(hidingPhrases(`שלום. ${phrase}.`)).toEqual([phrase])
  })

  it("detects a rule removed from the assembled prompt", () => {
    const rule = LIVE_SECRETARY_RULES.find(({ id }) => id === "delegate-default")
    expect(rule).toBeDefined()
    if (!rule) throw new Error("Missing delegation rule")
    const prompt = buildLiveSecretaryPrompt()
    expect(checkPromptRules(prompt.replace(rule.text, ""), LIVE_SECRETARY_RULES)).toEqual([rule.id])
  })

  it("tells the model which delegation tool to use and what each receipt allows it to report", () => {
    const actions = buildLiveActions()
    const compose = actions.find(({ name }) => name === "compose_prompt")?.description
    expect(compose).toContain("לכל בקשה לפעולה או לעובדה")
    expect(compose).toContain("אם קיבלת status:sent")
    expect(compose).toContain("אם קיבלת status:not_sent")
    expect(actions.find(({ name }) => name === "forward")?.description).toContain(
      "כשהמשתמש ביקש להעביר כלשונו",
    )
  })
})
