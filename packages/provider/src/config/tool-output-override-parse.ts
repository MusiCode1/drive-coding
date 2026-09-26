import {
  TOOL_OUTPUT_FIELDS,
  type JsonPath,
  type JsonPathSegment,
  type ToolOutputField,
  type ToolOutputFieldPaths,
  type ToolOutputMappingOverride,
} from "./tool-output-field-types.js"

const CANONICAL_FIELD_SET = new Set<string>(TOOL_OUTPUT_FIELDS)

function isToolOutputField(key: string): key is ToolOutputField {
  return CANONICAL_FIELD_SET.has(key)
}

function validateJsonPathSegment(segment: unknown, kind: string, context: string): JsonPathSegment | null {
  if (typeof segment === "string") {
    if (segment.length === 0) {
      console.warn(
        `[cli-config-file] override["${kind}"].toolOutput.${context}: path segment must be non-empty string — skipping path`,
      )
      return null
    }
    return segment
  }
  if (typeof segment === "number" && Number.isInteger(segment) && segment >= 0) {
    return segment
  }
  console.warn(
    `[cli-config-file] override["${kind}"].toolOutput.${context}: path segment must be non-empty string or non-negative integer — skipping path`,
  )
  return null
}

function validateJsonPath(path: unknown, kind: string, field: string): JsonPath | null {
  if (!Array.isArray(path) || path.length === 0) {
    console.warn(
      `[cli-config-file] override["${kind}"].toolOutput.fields["${field}"]: path must be a non-empty array — skipping path`,
    )
    return null
  }
  const segments: JsonPathSegment[] = []
  for (const segment of path) {
    const validated = validateJsonPathSegment(segment, kind, `fields["${field}"]`)
    if (validated === null) return null
    segments.push(validated)
  }
  return segments
}

export function validateFieldPathsFromOverride(
  raw: unknown,
  kind: string,
  strict: boolean,
): ToolOutputFieldPaths | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    const msg = `override["${kind}"].toolOutput.fields must be an object`
    if (strict) throw new Error(`[tool-output-mappings] ${msg}`)
    console.warn(`[cli-config-file] ${msg} — skipping toolOutput`)
    return null
  }
  const obj = raw as Record<string, unknown>
  const result: Partial<Record<ToolOutputField, JsonPath[]>> = {}

  for (const [field, paths] of Object.entries(obj)) {
    if (!isToolOutputField(field)) {
      console.warn(
        `[cli-config-file] override["${kind}"].toolOutput.fields: unknown field "${field}" — skipping field`,
      )
      continue
    }
    if (!Array.isArray(paths) || paths.length === 0) {
      console.warn(
        `[cli-config-file] override["${kind}"].toolOutput.fields["${field}"]: must be a non-empty array of paths — skipping field`,
      )
      continue
    }
    const validatedPaths: JsonPath[] = []
    for (const path of paths) {
      const validated = validateJsonPath(path, kind, field)
      if (validated !== null) validatedPaths.push(validated)
    }
    if (validatedPaths.length > 0) {
      result[field] = validatedPaths
    }
  }
  return result
}

/** Fail-open parser for cli-specs override `toolOutput` block. */
export function parseToolOutputOverride(
  kind: string,
  raw: unknown,
): ToolOutputMappingOverride | undefined {
  if (raw === undefined) return undefined
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    console.warn(`[cli-config-file] override["${kind}"].toolOutput must be an object — skipping field`)
    return undefined
  }
  const obj = raw as Record<string, unknown>
  if (!("fields" in obj)) {
    console.warn(`[cli-config-file] override["${kind}"].toolOutput must include fields — skipping field`)
    return undefined
  }
  const fields = validateFieldPathsFromOverride(obj["fields"], kind, false)
  if (fields === null || Object.keys(fields).length === 0) {
    return undefined
  }
  return { fields }
}
