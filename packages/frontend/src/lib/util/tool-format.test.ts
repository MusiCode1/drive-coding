import { describe, expect, it } from "vitest"
import { formatLocation, formatToolInput, normalizeToolOutput, prettyJson } from "./tool-format"

describe("formatToolInput", () => {
  it("{ command, description } → command variant with command + description", () => {
    const input = { command: "ls -la", description: "List files" }
    expect(formatToolInput(input)).toEqual({
      kind: "command",
      command: "ls -la",
      description: "List files",
    })
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

  it("{ foo: 1 } (no command) → fields variant", () => {
    const input = { foo: 1 }
    expect(formatToolInput(input)).toEqual({
      kind: "fields",
      fields: [{ key: "foo", value: "1" }],
    })
  })

  it("command non-string (e.g. number) → fields variant", () => {
    const input = { command: 123 }
    expect(formatToolInput(input)).toEqual({
      kind: "fields",
      fields: [{ key: "command", value: "123" }],
    })
  })

  it("{ code: '%%bash\\nls -la\\n' } → command variant", () => {
    expect(formatToolInput({ code: "%%bash\nls -la\n" })).toEqual({
      kind: "command",
      command: "ls -la",
    })
  })

  it("{ code: 'print(1)' } → code variant with python language", () => {
    expect(formatToolInput({ code: "print(1)" })).toEqual({
      kind: "code",
      code: "print(1)",
      language: "python",
    })
  })

  it("{ pattern, path } → fields with both keys in order", () => {
    const input = { pattern: "foo", path: "/a/b.ts" }
    expect(formatToolInput(input)).toEqual({
      kind: "fields",
      fields: [
        { key: "pattern", value: "foo" },
        { key: "path", value: "/a/b.ts" },
      ],
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
    expect(normalizeToolOutput({ exitCode: 0, stdout: "ok\n", stderr: "" })).toEqual({
      kind: "terminal",
      stdout: "ok\n",
      stderr: "",
      exitCode: 0,
    })
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
    expect(normalizeToolOutput([{ type: "text", text: "direct" }])).toEqual({
      kind: "text",
      text: "direct",
    })
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
    expect(normalizeToolOutput({ exitCode: 1, stderr: "boom", stdout: "" })).toEqual({
      kind: "terminal",
      stdout: "",
      stderr: "boom",
      exitCode: 1,
    })
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

const CODEX_MAPPING = {
  text: [["formatted_output"], ["result", "content", 0, "text"]],
  exitCode: [["exit_code"]],
} as const

describe("normalizeToolOutput — mapped paths", () => {
  it("Codex formatted_output + exit_code → text + exitCode", () => {
    expect(normalizeToolOutput({ formatted_output: "ok", exit_code: 0 }, CODEX_MAPPING)).toEqual({
      kind: "text",
      text: "ok",
      exitCode: 0,
    })
  })

  it("Codex nested result.content[0].text with error:null → text, not error null", () => {
    expect(
      normalizeToolOutput(
        {
          error: null,
          result: { content: [{ type: "string", text: "nested" }] },
        },
        CODEX_MAPPING,
      ),
    ).toEqual({ kind: "text", text: "nested", exitCode: undefined })
  })

  it("missing key on first path, second path wins", () => {
    const mapping = { text: [["missing"], ["formatted_output"]] } as const
    expect(normalizeToolOutput({ formatted_output: "win" }, mapping)).toEqual({
      kind: "text",
      text: "win",
    })
  })

  it("wrong-type value on first path, second path wins for text", () => {
    const mapping = { text: [["n"], ["t"]] } as const
    expect(normalizeToolOutput({ n: 5, t: "ok" }, mapping)).toEqual({
      kind: "text",
      text: "ok",
    })
  })

  it("string at mapped exitCode path is rejected", () => {
    const mapping = { exitCode: [["s"]], text: [["s"]] } as const
    expect(normalizeToolOutput({ s: "0" }, mapping)).toEqual({
      kind: "text",
      text: "0",
    })
  })

  it("non-boolean at mapped isError path tries next path", () => {
    const mapping = { isError: [["flag"], ["ok"]], text: [["msg"]] } as const
    expect(normalizeToolOutput({ flag: 0, ok: true, msg: "bad" }, mapping)).toEqual({
      kind: "error",
      message: "bad",
    })
  })

  it("missing object key tries next path", () => {
    const mapping = { text: [["no_such"], ["formatted_output"]] } as const
    expect(normalizeToolOutput({ formatted_output: "y" }, mapping)).toEqual({
      kind: "text",
      text: "y",
    })
  })

  it("array index out of range falls through", () => {
    const mapping = { text: [["items", 99, "x"], ["formatted_output"]] } as const
    expect(normalizeToolOutput({ formatted_output: "z" }, mapping)).toEqual({
      kind: "text",
      text: "z",
    })
  })

  it("inherited property is not accessible", () => {
    const proto = { inherited: "nope" }
    const raw = Object.create(proto) as Record<string, unknown>
    raw.formatted_output = "own"
    const mapping = { text: [["inherited"], ["formatted_output"]] } as const
    expect(normalizeToolOutput(raw, mapping)).toEqual({ kind: "text", text: "own" })
  })

  it("string segment on array rejects path", () => {
    const mapping = { text: [["0"]] } as const
    expect(normalizeToolOutput(["a"], mapping)).toEqual({ kind: "json", json: prettyJson(["a"]) })
  })

  it("exitCode + text without stdout/stderr → text + exitCode, not terminal", () => {
    expect(normalizeToolOutput({ formatted_output: "t", exit_code: 2 }, CODEX_MAPPING)).toEqual({
      kind: "text",
      text: "t",
      exitCode: 2,
    })
  })

  it("exitCode + stdout/stderr → terminal", () => {
    const mapping = {
      exitCode: [["exitCode"]],
      stdout: [["stdout"]],
      stderr: [["stderr"]],
    } as const
    expect(normalizeToolOutput({ exitCode: 1, stdout: "out", stderr: "err" }, mapping)).toEqual({
      kind: "terminal",
      stdout: "out",
      stderr: "err",
      exitCode: 1,
    })
  })

  it("mapped error string → error view", () => {
    const mapping = { error: [["message"]] } as const
    expect(normalizeToolOutput({ message: "fail" }, mapping)).toEqual({
      kind: "error",
      message: "fail",
    })
  })

  it("isError:true + mapped text → error with text", () => {
    const mapping = { isError: [["isError"]], text: [["content"]] } as const
    expect(normalizeToolOutput({ isError: true, content: "bad" }, mapping)).toEqual({
      kind: "error",
      message: "bad",
    })
  })

  it("isError:true without extracted text → error with prettyJson(raw)", () => {
    const mapping = { isError: [["isError"]], text: [["missing"]] } as const
    const raw = { isError: true, code: 1 }
    expect(normalizeToolOutput(raw, mapping)).toEqual({
      kind: "error",
      message: prettyJson(raw),
    })
  })

  it("partial mapping with only exitCode falls back to generic", () => {
    const mapping = { exitCode: [["exit_code"]] } as const
    expect(normalizeToolOutput({ formatted_output: "ok", exit_code: 0 }, mapping)).toEqual({
      kind: "stat",
      stats: [
        { key: "formatted_output", value: "ok" },
        { key: "exit_code", value: "0" },
      ],
    })
  })

  it("without mapping matches prior generic behavior for Codex stat shape", () => {
    expect(normalizeToolOutput({ formatted_output: "ok", exit_code: 0 })).toEqual({
      kind: "stat",
      stats: [
        { key: "formatted_output", value: "ok" },
        { key: "exit_code", value: "0" },
      ],
    })
  })
})
