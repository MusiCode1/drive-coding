/**
 * Synthetic rawOutput shapes from brief §3.ג — hand-authored, no wire recordings.
 */
export const TOOL_OUTPUT_SHAPES = [
  { name: "scalar-string", raw: "hello", expected: "text" as const },
  {
    name: "content-blocks",
    raw: { content: [{ type: "text", text: "block text" }] },
    expected: "text" as const,
  },
  {
    name: "terminal",
    raw: { exitCode: 0, stdout: "ok", stderr: "" },
    expected: "terminal" as const,
  },
  { name: "content-string", raw: { content: "plain" }, expected: "text" as const },
  {
    name: "totalMatches-stat",
    raw: { totalMatches: 5, truncated: false },
    expected: "stat" as const,
  },
  {
    name: "content-block-array",
    raw: [{ type: "text", text: "direct array" }],
    expected: "text" as const,
  },
  {
    name: "totalFiles-stat",
    raw: { totalFiles: 3, truncated: true },
    expected: "stat" as const,
  },
  {
    name: "tool-reference-array",
    raw: [{ tool_name: "Read", type: "tool_reference" }],
    expected: "json" as const,
  },
  {
    name: "metadata-output",
    raw: { metadata: { source: "test" }, output: "result text" },
    expected: "text" as const,
  },
  { name: "error-object", raw: { error: "failed" }, expected: "error" as const },
  {
    name: "source-type-array",
    raw: [{ source: "web", type: "url" }],
    expected: "json" as const,
  },
  { name: "success-stat", raw: { success: true }, expected: "stat" as const },
  { name: "referenceCount-stat", raw: { referenceCount: 2 }, expected: "stat" as const },
  {
    name: "content-details-isError-false",
    raw: {
      content: [{ type: "text", text: "jupyter ok" }],
      details: { durationMs: 100, status: "ok", stdout: "", stderr: "" },
      isError: false,
    },
    expected: "text" as const,
  },
] as const
