import { describe, expect, it } from "vitest"
import { isSubagentToolCall } from "./subagent-tool-identity"

describe("isSubagentToolCall", () => {
  it("Agent + think → true (toolName branch)", () => {
    expect(isSubagentToolCall("think", { claudeCode: { toolName: "Agent" } })).toBe(true)
  })

  it("Task → true", () => {
    expect(isSubagentToolCall("execute", { claudeCode: { toolName: "Task" } })).toBe(true)
  })

  it("Bash + execute → false", () => {
    expect(isSubagentToolCall("execute", { claudeCode: { toolName: "Bash" } })).toBe(false)
  })

  it("TaskCreate + think → false", () => {
    expect(isSubagentToolCall("think", { claudeCode: { toolName: "TaskCreate" } })).toBe(false)
  })

  it("no meta + think → true (fallback branch)", () => {
    expect(isSubagentToolCall("think", undefined)).toBe(true)
  })

  it("no meta + execute → false", () => {
    expect(isSubagentToolCall("execute", undefined)).toBe(false)
  })

  it("claudeCode not object → fallback to kind", () => {
    expect(isSubagentToolCall("think", { claudeCode: "broken" })).toBe(true)
    expect(isSubagentToolCall("execute", { claudeCode: null })).toBe(false)
  })
})
