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
export type ToolOutputFieldPaths = Partial<Readonly<Record<ToolOutputField, readonly JsonPath[]>>>

export type VerifiedAgainst = {
  readonly bridge: string
  readonly version: string
}

export type DefaultToolOutputMapping = {
  readonly verifiedAgainst: VerifiedAgainst
  readonly fields: ToolOutputFieldPaths
}

export type ToolOutputMappingOverride = {
  readonly fields: ToolOutputFieldPaths
}

export type EffectiveToolOutputMapping = {
  readonly verifiedAgainst?: VerifiedAgainst
  readonly fields: ToolOutputFieldPaths
}

export type ToolOutputMappingsProjection = Readonly<Record<string, ToolOutputFieldPaths>>
