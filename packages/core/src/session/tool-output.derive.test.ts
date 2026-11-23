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

function forbiddenDependencies(source: string): string[] {
  const imports = [...source.matchAll(/\bimport\s+(?:[^"'();]+?\s+from\s+)?["']([^"']+)["']/g)]
  const vocabulary = [...source.matchAll(/["'](terminal|codex|\$meta)["']/gi)]
  return [
    ...imports.flatMap(([, specifier]) =>
      specifier && specifier !== "./types" ? [specifier] : [],
    ),
    ...vocabulary.map(([literal]) => literal),
  ]
}

it("keeps the output reducer generic and free of I/O dependencies", () => {
  const source = readFileSync(new URL("./tool-output.ts", import.meta.url), "utf8")
  expect(forbiddenDependencies(source)).toEqual([])
  expect(forbiddenDependencies(`import "node:fs"\n${source}`)).toEqual(["node:fs"])
})
