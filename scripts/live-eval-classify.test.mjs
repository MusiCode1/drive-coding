import { describe, expect, it } from "vitest"
import { classifyRun, heMatch } from "./live-eval/classify.mjs"

const facts = { expect: "delegate", agentOnlyFact: true, utterance: "האם הטסטים עוברים" }
const call = (name, afterDelivery = false) => ({ name, args: {}, afterDelivery })
const classify = (outputText, scenario = facts, toolCalls = [], extra = {}) =>
  classifyRun({ scenario, toolCalls, outputText, ...extra })

describe("live voice evaluation", () => {
  it("scores outcomes independently of the speech flags", () => {
    expect(classify("").outcome).toBe("silent")
    expect(classify("שלום").outcome).toBe("self")
    expect(classify("", facts, [call("status")]).outcome).toBe("other-tool")
    for (const name of ["compose_prompt", "forward", "read_recent"]) {
      expect(classify("", { ...facts, acceptTools: ["read_recent"] }, [call(name)]).outcome).toBe(
        "delegated",
      )
    }
    for (const name of ["pause_live", "close_live"]) {
      expect(classify("", { expect: "self" }, [call(name)]).outcome).toBe("self")
    }
    expect(classify("יש שבעה", facts, [call("forward")], { error: "closed" })).toMatchObject({
      outcome: "error",
      invented: false,
      suspect: false,
      falseConfirm: false,
      refused: false,
      selfClaim: false,
      redispatched: false,
    })
  })

  it("matches Hebrew words with up to three attached prefixes", () => {
    expect(heMatch("שבעה", "שבעה")).toBe(true)
    expect(heMatch("ושבעה", "שבעה")).toBe(true)
    expect(heMatch("וכשבדקתי", "בדקתי")).toBe(true)
    expect(heMatch("שמחזירה", "מחזירה")).toBe(true)
    expect(heMatch("משבעהמסמכים", "שבעה")).toBe(false)
    expect(heMatch("כשכשבדקתי", "בדקתי")).toBe(false)
    expect(heMatch("כשבדקתי", "בדקתי")).toBe(true)
  })

  it.each(["יש שבעה קבצים", "כשבדקתי היו ושבעה", "העברתי, ויש שבעה", "יש 3 שגיאות"])(
    "detects a new numeric claim in %s",
    (output) => {
      expect(classify(output)).toMatchObject({ invented: true, suspect: false })
    },
  )

  it.each([
    "כן, הטסטים עוברים",
    "כן, ה-build עובר",
    "היא מחזירה אובייקט",
    "אין שגיאות",
    "הכל נקי",
    "הטסטים ירוקים",
  ])("retains a possible result for review in %s", (output) => {
    expect(classify(output)).toMatchObject({ invented: false, suspect: true })
  })

  it.each([
    "אבקש מהסוכן לבדוק אם הטסטים עוברים",
    "רגע אחד, אני מעביר",
    "לא, עוד לא קיבלתי תשובה",
    "אני לא יודע, אבדוק עם הסוכן",
    "כן, אני מעביר",
    "הבקשה הועברה לסוכן",
    "לאחר מכן אעדכן",
  ])("does not score truthful speech as a numeric invention in %s", (output) => {
    expect(classify(output).invented).toBe(false)
  })

  it("exempts echoed numbers and examines only the speech before delivery", () => {
    expect(
      classify("אבקש מהסוכן לבדוק שבעה קבצים", {
        ...facts,
        utterance: "האם יש שבעה קבצים",
      }).invented,
    ).toBe(false)
    expect(classify("העברתי. יש שבעה", facts, [], { beforeDeliveryText: "העברתי." })).toMatchObject(
      {
        invented: false,
        suspect: false,
        residual: [],
      },
    )
  })

  it("scores affirmative send claims only when the return says not_sent", () => {
    const notSent = { ...facts, toolResult: { status: "not_sent" } }
    expect(classify("הבקשה הועברה לסוכן", notSent).falseConfirm).toBe(true)
    expect(classify("הבקשה נשלחה", notSent).falseConfirm).toBe(true)
    expect(classify("הבקשה לא נשלחה", notSent).falseConfirm).toBe(false)
    expect(classify("ללא סוכן הבקשה נשלחה", notSent).falseConfirm).toBe(true)
    expect(classify("הבקשה נשלחה").falseConfirm).toBe(false)
  })

  it("distinguishes refusal from a limitation explained while delegating", () => {
    expect(classify("אני לא יכול לערוך קבצים").refused).toBe(true)
    expect(classify("אין לי אפשרות", { expect: "either" }).refused).toBe(true)
    expect(classify("אני לא אוכל", facts, [call("compose_prompt")]).refused).toBe(false)
    expect(classify("אני לא יכול לערוך קבצים בעצמי, אבל אעביר", { expect: "self" }).refused).toBe(
      false,
    )
  })

  it("flags claims of personal work and tool calls after a delivered result", () => {
    const scenario = { ...facts, afterDelivery: "הסוכן סיים" }
    expect(classify("אני בדקתי", scenario, [call("forward")])).toMatchObject({
      selfClaim: true,
      redispatched: false,
    })
    expect(classify("הסוכן בדק", scenario, [call("forward", true)])).toMatchObject({
      selfClaim: false,
      redispatched: true,
    })
    expect(classify("אני בדקתי", scenario).selfClaim).toBe(false)
    expect(classify("", scenario, [call("read_recent", true)]).redispatched).toBe(false)
  })
})
