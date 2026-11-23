import type { JsonPath, ToolMetaKeyMode, ToolOutputField } from "@drive-coding/core/session"

export { type JsonPath, TOOL_OUTPUT_FIELDS, type ToolOutputField } from "@drive-coding/core/session"

// The first segment names metadata instead of a raw-output field. This token is reserved.
export const META_ROOT = "$meta"
export type JsonPathSegment = JsonPath[number]
export type ToolOutputFieldPaths = Partial<Readonly<Record<ToolOutputField, readonly JsonPath[]>>>
export type ToolOutputMetaKeys = Readonly<Record<string, ToolMetaKeyMode>>

export type VerifiedAgainst = {
  readonly bridge: string
  readonly version: string
}

export type ToolOutputMappingOverride = {
  readonly fields?: ToolOutputFieldPaths
  readonly metaKeys?: ToolOutputMetaKeys
}

export type DefaultToolOutputMapping = {
  readonly verifiedAgainst: VerifiedAgainst
  readonly fields: ToolOutputFieldPaths
  readonly metaKeys?: ToolOutputMetaKeys
}

export type EffectiveToolOutputMapping = Omit<DefaultToolOutputMapping, "verifiedAgainst"> & {
  readonly verifiedAgainst?: VerifiedAgainst
}

export type ToolOutputMappingsProjection = Readonly<Record<string, ToolOutputFieldPaths>>
