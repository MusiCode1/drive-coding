// @vitest-environment jsdom
/** A terminal reference supplies identity. The canonical output supplies its body (bug #86). */
import { flushSync, mount, unmount } from "svelte"
import { afterEach, describe, expect, it } from "vitest"
import type { ToolBubble as ToolBubbleType } from "$lib/types/bubble"
import ToolBubbleHarness from "./tool-bubble-output-harness.svelte"

let target: HTMLDivElement | null = null
let app: object | null = null

afterEach(() => {
  if (app !== null) unmount(app)
  target?.remove()
  target = null
  app = null
})

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
      output: { text: "hello from terminal", exitCode: 3 },
    },
  } as ToolBubbleType
}

function render(bubble: ToolBubbleType): void {
  target = document.createElement("div")
  document.body.appendChild(target)
  app = mount(ToolBubbleHarness, { target, props: { bubble } })
  flushSync()
}

describe("bugs/86 — ‏הפניית-טרמינל אינה מכבה את הפלט", () => {
  it("shows canonical output in the result body with no raw output", () => {
    render(bubbleWithTerminalRef())
    // 🛑 ‏`textContent` ‏של הבועה כולה אינו מספיק — ‏המחרוזת מופיעה ממילא
    // ‏בתוך "‏פלט גולמי". ‏הטענה חייבת להיות על **‏גוף התוצאה המנורמל**.
    const resultPre = target?.querySelector(".tool-text-wrapper pre")
    expect(resultPre?.textContent).toBe("hello from terminal")
    expect(target?.querySelector(".raw-output")).toBeNull()
  })

  it("‏מציגה צ'יפ קוד-יציאה גם כשיש בלוק-טרמינל", () => {
    render(bubbleWithTerminalRef())
    expect(target?.querySelector(".exit-chip")?.textContent).toContain("3")
  })

  it("‏ההפניה עצמה נשארת — ‏היא מזהה את הטרמינל ל-debug", () => {
    render(bubbleWithTerminalRef())
    expect(target?.textContent ?? "").toContain("exec-f073496a")
  })
})
