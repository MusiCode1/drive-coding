import { describe, expect, it } from "vitest"
import { en } from "../src/i18n/catalogs/en.js"
import { he } from "../src/i18n/catalogs/he.js"

describe("agent and ACP session terminology", () => {
  it.each([
    ["connect.agents.title", "Active agents", "סוכנים פעילים"],
    ["connect.agents.empty", "No active agents", "אין סוכנים פעילים"],
    ["connect.agents.childCount", "Child agents", "סוכנים ילדים"],
    ["connect.agents.close", "Close agent", "סגור סוכן"],
    ["connect.agents.closeConfirm", "Confirm closing agent", "אשר סגירת סוכן"],
    ["agent.close", "Close agent", "סגור סוכן"],
    ["session.delete", "Delete session", "מחק שיחה"],
    ["session.deleteConfirm", "Confirm deleting session", "אשר מחיקת שיחה"],
    ["session.copyId", "Copy ACP session ID", "העתק מזהה שיחת ACP"],
    ["agentNotes.title", "Agent notes", "הערות סוכן"],
    ["agentNotes.open", "Open agent notes", "פתח הערות סוכן"],
    ["agentNotes.minimize", "Minimize agent notes", "צמצם הערות סוכן"],
    [
      "agentNotes.placeholder",
      "Reminders or notes about this agent…",
      "תזכורות או הערות על הסוכן…",
    ],
    ["settings.toggle.agentNotes", "Agent notes", "הערות סוכן"],
    ["agent.fieldsLabel", "Agent fields", "שדות סוכן"],
    ["agent.fieldsEmpty", "No agent fields", "אין שדות סוכן"],
    ["sidebar.agentOptions", "Session options", "אפשרויות שיחה"],
    ["agentOptions.title", "Session options", "אפשרויות שיחה"],
    ["configName.agent", "Persona", "פרסונה"],
    ["agentOptions.agent.label", "Persona", "פרסונה"],
    ["chat.subagent.transcript", "Subtask activity", "פעילות משימת משנה"],
    ["connect.agents.watcherCount", "viewers", "צופים"],
    ["session.leaveRunning", "Leave — keep running", "צא — השאר רץ"],
    ["settings.sessionTransport.label", "Session transport", "טרנספורט סשן"],
  ] as const)("renders %s in English and Hebrew", (key, english, hebrew) => {
    expect(en[key]).toBe(english)
    expect(he[key]).toBe(hebrew)
  })

  it("keeps the complete agent approvals namespace in both catalogs", () => {
    const expected = [
      "close",
      "empty",
      "error",
      "loading",
      "message",
      "note",
      "option.inherit",
      "retry",
      "saving",
      "source.agent",
      "source.default",
      "source.env",
      "source.override",
      "sourceLabel",
      "title",
      "update",
    ]
      .map((key) => `agent.scopePolicy.${key}`)
      .sort()
    for (const catalog of [en, he]) {
      expect(
        Object.keys(catalog)
          .filter((key) => key.startsWith("agent.scopePolicy."))
          .sort(),
      ).toEqual(expected)
    }
  })

  it("ships only supported scripts in the terminology values and removes migrated keys", () => {
    for (const catalog of [en, he]) {
      const retired =
        /^(?:sessionMemo\.|session\.scopePolicy\.|session\.fields(?:Label|Empty)$|session\.closeSession$|connect\.agents\.kill|settings\.toggle\.sessionMemo$)/
      expect(Object.keys(catalog).filter((key) => retired.test(key))).toEqual([])
      const terminology =
        /^(?:agent\.|agentNotes\.|agentOptions\.|configName\.agent$|connect\.agents\.|session\.(?:delete|copyId)|settings\.toggle\.agentNotes$|sidebar\.agentOptions$|chat\.subagent\.transcript$)/
      const unexpectedScript =
        /[^\p{Script=Latin}\p{Script=Hebrew}\p{Script=Common}\p{Script=Inherited}]/u
      for (const [key, value] of Object.entries(catalog)) {
        if (terminology.test(key)) expect(value, key).not.toMatch(unexpectedScript)
      }
    }
  })
})
