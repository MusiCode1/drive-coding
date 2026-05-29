import { describe, it, expect } from "vitest"
import { formatToolInput, prettyJson, formatLocation } from "./tool-format"

describe("formatToolInput", () => {
  it("{ command, description } → command variant with command string", () => {
    const input = { command: "ls -la", description: "List files" }
    expect(formatToolInput(input)).toEqual({ kind: "command", command: "ls -la" })
  })

  it("{ command } only → command variant", () => {
    const input = { command: "date" }
    expect(formatToolInput(input)).toEqual({ kind: "command", command: "date" })
  })

  it("{} → empty", () => {
    expect(formatToolInput({})).toEqual({ kind: "empty" })
  })

  it("undefined → empty", () => {
    expect(formatToolInput(undefined)).toEqual({ kind: "empty" })
  })

  it("null → empty", () => {
    expect(formatToolInput(null)).toEqual({ kind: "empty" })
  })

  it("{ foo: 1 } (no command) → json variant, pretty-printed", () => {
    const input = { foo: 1 }
    expect(formatToolInput(input)).toEqual({
      kind: "json",
      json: JSON.stringify(input, null, 2),
    })
  })

  it("command non-string (e.g. number) → json variant", () => {
    const input = { command: 123 }
    expect(formatToolInput(input)).toEqual({
      kind: "json",
      json: JSON.stringify(input, null, 2),
    })
  })

  it("string rawInput → json variant (stringified)", () => {
    const input = "just a string"
    expect(formatToolInput(input)).toEqual({
      kind: "json",
      json: JSON.stringify(input, null, 2),
    })
  })
})

describe("prettyJson", () => {
  it("object → 2-space indented", () => {
    const obj = { a: 1, b: { c: 2 } }
    expect(prettyJson(obj)).toBe(JSON.stringify(obj, null, 2))
  })

  it("string → quoted JSON string", () => {
    expect(prettyJson("foo")).toBe('"foo"')
  })

  it("circular ref → falls back to String(), no throw", () => {
    const obj: any = { a: 1 }
    obj.self = obj
    expect(() => prettyJson(obj)).not.toThrow()
    expect(prettyJson(obj)).toBe(String(obj))
  })
})

describe("formatLocation", () => {
  it("{ path, line } → 'path:line'", () => {
    expect(formatLocation({ path: "src/main.ts", line: 10 })).toBe("src/main.ts:10")
  })

  it("{ path } → 'path'", () => {
    expect(formatLocation({ path: "README.md" })).toBe("README.md")
  })
})
