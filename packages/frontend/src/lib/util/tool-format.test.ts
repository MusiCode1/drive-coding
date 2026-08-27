import { describe, it, expect } from "vitest"
import {
  formatToolInput,
  prettyJson,
  formatLocation,
  normalizeToolOutput,
} from "./tool-format"

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

describe("normalizeToolOutput", () => {
  it("undefined / null / empty string → empty", () => {
    expect(normalizeToolOutput(undefined)).toEqual({ kind: "empty" })
    expect(normalizeToolOutput(null)).toEqual({ kind: "empty" })
    expect(normalizeToolOutput("")).toEqual({ kind: "empty" })
  })

  it("scalar string → text", () => {
    expect(normalizeToolOutput("hello")).toEqual({ kind: "text", text: "hello" })
  })

  it("{content: ContentBlock[]} → text (joined)", () => {
    expect(
      normalizeToolOutput({
        content: [
          { type: "text", text: "line1" },
          { type: "text", text: "line2" },
        ],
      }),
    ).toEqual({ kind: "text", text: "line1\nline2" })
  })

  it("{exitCode, stderr, stdout} → terminal", () => {
    expect(
      normalizeToolOutput({ exitCode: 0, stdout: "ok\n", stderr: "" }),
    ).toEqual({ kind: "terminal", stdout: "ok\n", stderr: "", exitCode: 0 })
  })

  it("{content: string} → text", () => {
    expect(normalizeToolOutput({ content: "plain text" })).toEqual({
      kind: "text",
      text: "plain text",
    })
  })

  it("{totalMatches, truncated} → stat", () => {
    const result = normalizeToolOutput({ totalMatches: 42, truncated: false })
    expect(result.kind).toBe("stat")
    if (result.kind === "stat") {
      expect(result.stats).toEqual([
        { key: "totalMatches", value: "42" },
        { key: "truncated", value: "false" },
      ])
    }
  })

  it("ContentBlock[] (direct array) → text", () => {
    expect(
      normalizeToolOutput([{ type: "text", text: "direct" }]),
    ).toEqual({ kind: "text", text: "direct" })
  })

  it("{totalFiles, truncated} → stat", () => {
    const result = normalizeToolOutput({ totalFiles: 10, truncated: true })
    expect(result.kind).toBe("stat")
    if (result.kind === "stat") {
      expect(result.stats).toEqual([
        { key: "totalFiles", value: "10" },
        { key: "truncated", value: "true" },
      ])
    }
  })

  it("array of {tool_name,type} → json fallback", () => {
    const input = [{ tool_name: "Read", type: "tool_reference" }]
    const result = normalizeToolOutput(input)
    expect(result).toEqual({ kind: "json", json: prettyJson(input) })
  })

  it("{metadata, output} → text from output", () => {
    expect(normalizeToolOutput({ metadata: {}, output: "result text" })).toEqual({
      kind: "text",
      text: "result text",
    })
  })

  it("{error} → error", () => {
    expect(normalizeToolOutput({ error: "something failed" })).toEqual({
      kind: "error",
      message: "something failed",
    })
  })

  it("array of {source,type} → json fallback", () => {
    const input = [{ source: "web", type: "url" }]
    const result = normalizeToolOutput(input)
    expect(result).toEqual({ kind: "json", json: prettyJson(input) })
  })

  it("{success} → stat", () => {
    const result = normalizeToolOutput({ success: true })
    expect(result.kind).toBe("stat")
    if (result.kind === "stat") {
      expect(result.stats).toEqual([{ key: "success", value: "true" }])
    }
  })

  it("{referenceCount} → stat", () => {
    const result = normalizeToolOutput({ referenceCount: 3 })
    expect(result.kind).toBe("stat")
    if (result.kind === "stat") {
      expect(result.stats).toEqual([{ key: "referenceCount", value: "3" }])
    }
  })

  it("{content, details, isError:false} → text", () => {
    expect(
      normalizeToolOutput({
        content: [{ type: "text", text: "jupyter output" }],
        details: { durationMs: 100, status: "ok", stdout: "", stderr: "" },
        isError: false,
      }),
    ).toEqual({ kind: "text", text: "jupyter output" })
  })

  it("preserves real newlines in stdout", () => {
    const result = normalizeToolOutput({
      exitCode: 0,
      stdout: "line1\nline2",
      stderr: "",
    })
    expect(result.kind).toBe("terminal")
    if (result.kind === "terminal") {
      expect(result.stdout).toBe("line1\nline2")
    }
  })

  it("{} → empty", () => {
    expect(normalizeToolOutput({})).toEqual({ kind: "empty" })
  })

  it("{exitCode:1, stderr:boom, stdout:} → terminal with exitCode 1", () => {
    expect(
      normalizeToolOutput({ exitCode: 1, stderr: "boom", stdout: "" }),
    ).toEqual({ kind: "terminal", stdout: "", stderr: "boom", exitCode: 1 })
  })

  it("empty array → json", () => {
    const result = normalizeToolOutput([])
    expect(result).toEqual({ kind: "json", json: prettyJson([]) })
  })

  it("nested object → json", () => {
    const input = { nested: { a: 1 } }
    expect(normalizeToolOutput(input)).toEqual({
      kind: "json",
      json: prettyJson(input),
    })
  })

  it("{content,details,isError:true} → error with message from content (not prettyJson)", () => {
    expect(
      normalizeToolOutput({
        content: [{ type: "text", text: "boom" }],
        details: { durationMs: 50 },
        isError: true,
      }),
    ).toEqual({ kind: "error", message: "boom" })
  })
})
