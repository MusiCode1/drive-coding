/**
 * DTO mirror of provider `TOOL_OUTPUT_FIELDS` / path types — no runtime import from provider.
 * Keep in sync with packages/provider/src/config/tool-output-field-types.ts (gate in test).
 */

export const TOOL_OUTPUT_FIELDS = [
  "text",
  "exitCode",
  "stdout",
  "stderr",
  "error",
  "isError",
] as const

export type ToolOutputField = (typeof TOOL_OUTPUT_FIELDS)[number]
export type JsonPathSegment = string | number
export type JsonPath = readonly JsonPathSegment[]
export type ToolOutputFieldPaths = Partial<
  Readonly<Record<ToolOutputField, readonly JsonPath[]>>
>
