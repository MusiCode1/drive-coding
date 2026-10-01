// @vitest-environment jsdom
/**
 * bugs/86 — ‏הפניית-טרמינל היא `terminalId` ‏בלבד ואינה נושאת תוכן.
 * ‏ספירתה כ"תוכן" ‏מכבה את ההיטל המנורמל, ‏ולכן **‏כל `exec` ‏שקודקס לא סיווג**
 * ‏מאבד את הפלט הקריא. ‏הגשר שולח `rawOutput` ‏בשני המסלולים — ‏הכשל אצלנו.
 */
import { flushSync, mount, unmount } from "svelte"
import { afterEach, describe, expect, it } from "vitest"
import type { ToolBubble as ToolBubbleType } from "$lib/types/bubble"
import ToolBubbleHarness from "./tool-bubble-output-mapping-harness.svelte"

const CODEX_MAPPING = {
  text: [["formatted_output"], ["result", "content", 0, "text"]],
  exitCode: [["exit_code"]],
} as const

let target: HTMLDivElement | null = null
let app: object | null = null

afterEach(() => {
  if (app !== null) unmount(app)
  target?.remove()
  target = null
  app = null
})

/** ‏בדיוק מה שהגשר שולח ב-`exec` ‏לא-מסווג: ‏הפניה ריקה **‏וגם** ‏פלט. */
function bubbleWithTerminalRef(): ToolBubbleType {
  return {
    id: "tb-term",
    kind: "tool",
    messageId: null,
    segments: [],
    createdAt: Date.now(),
    toolCall: {
      toolCallId: "tc-term",
      name: "shell",
      status: "completed",
      args: {},
      content: [{ type: "terminal", terminalId: "exec-f073496a" }],
      result: { formatted_output: "hello from terminal", exit_code: 0 },
    },
  } as ToolBubbleType
}

function render(bubble: ToolBubbleType): void {
  target = document.createElement("div")
  document.body.appendChild(target)
  app = mount(ToolBubbleHarness, { target, props: { bubble, outputMapping: CODEX_MAPPING } })
  flushSync()
}

describe("bugs/86 — ‏הפניית-טרמינל אינה מכבה את הפלט", () => {
  it("‏מציגה את `formatted_output` ‏בגוף התוצאה, ‏לא רק ב-JSON ‏הגולמי", () => {
    render(bubbleWithTerminalRef())
    // 🛑 ‏`textContent` ‏של הבועה כולה אינו מספיק — ‏המחרוזת מופיעה ממילא
    // ‏בתוך "‏פלט גולמי". ‏הטענה חייבת להיות על **‏גוף התוצאה המנורמל**.
    const resultPre = target?.querySelector(".tool-text-wrapper pre")
    expect(resultPre?.textContent).toBe("hello from terminal")
  })

  it("‏מציגה צ'יפ קוד-יציאה גם כשיש בלוק-טרמינל", () => {
    render(bubbleWithTerminalRef())
    expect(target?.querySelector(".exit-chip")).toBeTruthy()
  })

  it("‏ההפניה עצמה נשארת — ‏היא מזהה את הטרמינל ל-debug", () => {
    render(bubbleWithTerminalRef())
    expect(target?.textContent ?? "").toContain("exec-f073496a")
  })
})
