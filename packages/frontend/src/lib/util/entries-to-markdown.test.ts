import { describe, expect, it } from "vitest"
import { entriesToMarkdown } from "./entries-to-markdown"

describe("entriesToMarkdown", () => {
  it("returns empty string for empty input", () => {
    expect(entriesToMarkdown([])).toBe("")
  })

  it("marks completed entries with [x]", () => {
    expect(entriesToMarkdown([{ content: "Done task", status: "completed" }])).toBe(
      "- [x] Done task",
    )
  })

  it("marks pending and in_progress entries with [ ]", () => {
    expect(
      entriesToMarkdown([
        { content: "Todo", status: "pending" },
        { content: "Doing", status: "in_progress" },
      ]),
    ).toBe("- [ ] Todo\n- [ ] Doing")
  })

  it("treats unknown statuses as unchecked", () => {
    expect(entriesToMarkdown([{ content: "Maybe", status: "cancelled" }])).toBe("- [ ] Maybe")
  })

  it("preserves entry order", () => {
    expect(
      entriesToMarkdown([
        { content: "First", status: "pending" },
        { content: "Second", status: "completed" },
        { content: "Third", status: "in_progress" },
      ]),
    ).toBe("- [ ] First\n- [x] Second\n- [ ] Third")
  })

  it("does not emit priority to output", () => {
    const md = entriesToMarkdown([
      { content: "High", status: "pending", priority: "high" } as {
        content: string
        status: string
        priority?: string
      },
    ])
    expect(md).toBe("- [ ] High")
    expect(md).not.toContain("high")
    expect(md).not.toContain("priority")
  })
})
