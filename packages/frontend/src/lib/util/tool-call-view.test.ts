import { describe, it, expect } from "vitest"
import type { ToolCall } from "$lib/types/bubble"
import { isHumanTitle, normalizeToolCall, pickSummary } from "./tool-call-view"
import { formatToolInput } from "./tool-format"

function makeToolCall(overrides: Partial<ToolCall> & Pick<ToolCall, "toolCallId" | "name">): ToolCall {
  return {
    args: {},
    status: "completed",
    ...overrides,
  }
}

describe("isHumanTitle", () => {
  it("generic tool names → false", () => {
    expect(isHumanTitle("IPython cell")).toBe(false)
    expect(isHumanTitle("Bash")).toBe(false)
    expect(isHumanTitle("Read")).toBe(false)
  })

  it("Find / action+path → true", () => {
    expect(isHumanTitle("Find `**/*.ts`")).toBe(true)
    expect(isHumanTitle("Read `/src/main.ts`")).toBe(true)
  })

  it("command echo → false", () => {
    expect(isHumanTitle("cd /tmp && ls")).toBe(false)
    expect(isHumanTitle("git status")).toBe(false)
  })
})

describe("pickSummary", () => {
  it("Claude: description from command args when no narration", () => {
    const tc = makeToolCall({
      toolCallId: "t1",
      name: "bash",
      args: { command: "recollq -1 foo", description: "Check recoll config" },
      title: "recollq -1 foo",
    })
    const input = formatToolInput(tc.args)
    expect(pickSummary(tc, input)).toEqual({
      summary: "Check recoll config",
      summarySource: "description",
    })
  })

  it("Claude: narration replaces description", () => {
    const tc = makeToolCall({
      toolCallId: "t2",
      name: "bash",
      args: { command: "ls", description: "List files" },
      narration: "בודק קבצים",
    })
    const input = formatToolInput(tc.args)
    expect(pickSummary(tc, input)).toEqual({
      summary: "בודק קבצים",
      summarySource: "narration",
    })
  })

  it("Cursor Find title without description → title", () => {
    const tc = makeToolCall({
      toolCallId: "t3",
      name: "grep",
      title: "Find `**/*a290fe0*`",
      args: { pattern: "**/*a290fe0*", path: "/proj" },
    })
    const input = formatToolInput(tc.args)
    expect(pickSummary(tc, input)).toEqual({
      summary: "Find `**/*a290fe0*`",
      summarySource: "title",
    })
  })

  it("Cursor pattern+path without human title → input-extract from pattern", () => {
    const tc = makeToolCall({
      toolCallId: "t4",
      name: "grep",
      title: "Grep",
      args: { pattern: "foo", path: "/a/b.ts" },
    })
    const input = formatToolInput(tc.args)
    expect(pickSummary(tc, input)).toEqual({
      summary: "foo b.ts",
      summarySource: "input-extract",
    })
  })

  it("Prime %%bash → input-extract from command line", () => {
    const tc = makeToolCall({
      toolCallId: "t5",
      name: "ipython",
      title: "IPython cell",
      args: { code: "%%bash\nls -la\n" },
    })
    const input = formatToolInput(tc.args)
    expect(pickSummary(tc, input)).toEqual({
      summary: "ls -la",
      summarySource: "input-extract",
    })
  })

  it("IPython cell + python code → input-extract, not generic title", () => {
    const tc = makeToolCall({
      toolCallId: "t6",
      name: "ipython",
      title: "IPython cell",
      args: { code: "print(handle)" },
    })
    const input = formatToolInput(tc.args)
    expect(pickSummary(tc, input)).toEqual({
      summary: "print(handle)",
      summarySource: "input-extract",
    })
  })

  it("description-only args (Cursor Task) → description source", () => {
    const tc = makeToolCall({
      toolCallId: "t7",
      name: "task",
      args: { description: "Research the codebase" },
    })
    const input = formatToolInput(tc.args)
    expect(pickSummary(tc, input)).toEqual({
      summary: "Research the codebase",
      summarySource: "description",
    })
  })
})

describe("normalizeToolCall", () => {
  it("Claude bash: summary from description, input command", () => {
    const tc = makeToolCall({
      toolCallId: "c1",
      name: "bash",
      kind: "execute",
      args: { command: "recollq -1 foo", description: "Check recoll config" },
      title: "recollq -1 foo",
    })
    const view = normalizeToolCall(tc)
    expect(view.summary).toBe("Check recoll config")
    expect(view.summarySource).toBe("description")
    expect(view.input).toEqual({
      kind: "command",
      command: "recollq -1 foo",
      description: "Check recoll config",
    })
    expect(view.id).toBe("c1")
    expect(view.hasDetails).toBe(true)
  })

  it("Prime %%bash: input command, summary from command line", () => {
    const tc = makeToolCall({
      toolCallId: "p1",
      name: "ipython",
      title: "IPython cell",
      args: { code: "%%bash\nls -la\n" },
    })
    const view = normalizeToolCall(tc)
    expect(view.input).toEqual({ kind: "command", command: "ls -la" })
    expect(view.summary).toBe("ls -la")
    expect(view.summarySource).toBe("input-extract")
  })

  it("narration in ctx overrides description", () => {
    const tc = makeToolCall({
      toolCallId: "n1",
      name: "bash",
      args: { command: "ls", description: "List files" },
    })
    const view = normalizeToolCall(tc, { narration: "קריאת קבצים" })
    expect(view.summary).toBe("קריאת קבצים")
    expect(view.summarySource).toBe("narration")
  })

  it("empty args → hasDetails false when no output/content", () => {
    const tc = makeToolCall({
      toolCallId: "e1",
      name: "noop",
      args: {},
    })
    const view = normalizeToolCall(tc)
    expect(view.input.kind).toBe("empty")
    expect(view.hasDetails).toBe(false)
  })
})
