import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { deriveToolOutputDelta, TOOL_OUTPUT_TEXT_CAP, type ToolOutputRules } from "./tool-output"

const rules: ToolOutputRules = {
  fields: {
    text: [
      { from: "meta", key: "chunks", path: ["data"] },
      { from: "raw", path: ["result", "content", 0, "text"] },
    ],
    error: [{ from: "raw", path: ["error"] }],
    exitCode: [{ from: "meta", key: "complete", path: ["code"] }],
    isError: [{ from: "raw", path: ["isError"] }],
  },
  metaKeys: { chunks: "append", complete: "replace" },
}

describe("derive canonical tool output", () => {
  it("uses the first typed source and keeps priority between frames", () => {
    const lower = deriveToolOutputDelta(
      {},
      {
        hasRawOutput: true,
        rawOutput: { error: null, result: { content: [{ text: "fallback" }] }, isError: false },
        meta: { chunks: { data: 1 } },
      },
      rules,
    )
    expect(lower).toEqual({
      delta: { set: { text: "fallback", isError: false } },
      output: { text: "fallback", isError: false },
      rank: { text: 1, isError: 0 },
    })
    const higher = deriveToolOutputDelta(
      lower,
      { hasRawOutput: false, meta: { chunks: { data: "new" } } },
      rules,
    )
    expect(higher.delta).toEqual({ set: { text: "new" } })
    const unchanged = deriveToolOutputDelta(
      higher,
      { hasRawOutput: true, rawOutput: { result: { content: [{ text: "ignored" }] } } },
      rules,
    )
    expect(unchanged).toEqual({ ...higher, delta: undefined })
    const appended = deriveToolOutputDelta(
      unchanged,
      { hasRawOutput: false, meta: { chunks: { data: " tail" } } },
      rules,
    )
    expect(appended.delta).toEqual({ append: { text: " tail" } })
    expect(appended.output?.text).toBe("new tail")
  })

  it("reads raw sources only from the active frame and replaces whole values", () => {
    const first = deriveToolOutputDelta(
      {},
      { hasRawOutput: false, meta: { complete: { code: 3 } } },
      rules,
    )
    const second = deriveToolOutputDelta(
      first,
      {
        hasRawOutput: false,
        rawOutput: { error: "not present on frame" },
        meta: { complete: { code: 4 } },
      },
      rules,
    )
    expect(second.output).toEqual({ exitCode: 4 })
    expect(second.delta).toEqual({ set: { exitCode: 4 } })
  })

  it("sends capped replacements and full append chunks, signalling truncation once", () => {
    const chunk = `x${"y".repeat(TOOL_OUTPUT_TEXT_CAP)}`
    const frame = { hasRawOutput: false, meta: { chunks: { data: chunk } } }
    const initial = deriveToolOutputDelta({}, frame, rules)
    expect(initial.delta).toEqual({ set: { text: chunk.slice(1) }, truncated: true })
    const appended = deriveToolOutputDelta(initial, frame, rules)
    expect(appended.delta).toEqual({ append: { text: chunk } })
    expect(appended.output).toEqual(initial.output)
  })
})

const ADAPTER_MARK = /terminal|codex|\$meta|mcp_output_delta|is_mcp_tool_call/i
const ALLOWED_IMPORT = "./types"

function quotedSpecifier(rest: string): string | undefined {
  const literal = /^\s*(["'`])([^"'`]*)\1/.exec(rest)
  const specifier = literal?.[2]
  return specifier && specifier.length > 0 ? specifier : undefined
}

function forbiddenDependencies(source: string): string[] {
  const imports = [
    ...source.matchAll(/\bimport\s+(?:[^"'();]+?\s+from\s+)?["']([^"']+)["']/g),
  ].flatMap(([, specifier]) => (specifier && specifier !== ALLOWED_IMPORT ? [specifier] : []))
  const dynamicImports = [...source.matchAll(/\bimport\s*\(/g)].flatMap((match) => {
    const specifier = quotedSpecifier(source.slice((match.index ?? 0) + match[0].length))
    if (specifier === ALLOWED_IMPORT) return []
    return [specifier ?? "import()"]
  })
  const requires = [...source.matchAll(/\brequire\s*\(/g)].map((match) => {
    return quotedSpecifier(source.slice((match.index ?? 0) + match[0].length)) ?? "require()"
  })
  const vocabulary = [...source.matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g)].flatMap((match) => {
    const body = match[2] ?? ""
    return ADAPTER_MARK.test(body) ? [match[0]] : []
  })
  return [...imports, ...dynamicImports, ...requires, ...vocabulary]
}

describe("tool-output.ts stays generic", () => {
  const source = readFileSync(new URL("./tool-output.ts", import.meta.url), "utf8")

  it("imports nothing adapter-specific and performs no I/O", () => {
    expect(forbiddenDependencies(source)).toEqual([])
  })

  it("still allows the types module, including a dynamic import", () => {
    expect(forbiddenDependencies(`import { x } from "./types"\n${source}`)).toEqual([])
    expect(forbiddenDependencies(`import("./types")\n${source}`)).toEqual([])
  })

  it.each<[string, string[]]>([
    [`import "node:fs"`, ["node:fs"]],
    [`import("node:fs")`, ["node:fs"]],
    [`import(specifier)`, ["import()"]],
    [`require("node:fs")`, ["node:fs"]],
    [`require(id)`, ["require()"]],
    [`const key = "terminal_output_delta"`, ['"terminal_output_delta"']],
    [`const key = "terminal_exit"`, ['"terminal_exit"']],
    [`const key = 'terminal_info'`, ["'terminal_info'"]],
    [`const key = "mcp_output_delta"`, ['"mcp_output_delta"']],
    [`const key = "is_mcp_tool_call"`, ['"is_mcp_tool_call"']],
    [`const key = "$meta"`, ['"$meta"']],
    [`const key = "codex"`, ['"codex"']],
  ])("flags %s", (snippet, expected) => {
    expect(forbiddenDependencies(`${snippet}\n${source}`)).toEqual(expected)
  })
})
