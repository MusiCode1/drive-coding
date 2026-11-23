import type { ToolMetaKeyMode } from "@drive-coding/core/session"
import {
  type JsonPath,
  type JsonPathSegment,
  TOOL_OUTPUT_FIELDS,
  type ToolOutputField,
  type ToolOutputFieldPaths,
  type ToolOutputMappingOverride,
  type ToolOutputMetaKeys,
} from "./tool-output-field-types.js"

type Invalid = (reason: string) => void

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function validateNote(obj: Record<string, unknown>, context: string, invalid: Invalid): void {
  if ("note" in obj && typeof obj.note !== "string") invalid(`${context}.note must be a string`)
}

function isPathSegment(value: unknown): value is JsonPathSegment {
  return typeof value === "string"
    ? value.length > 0
    : typeof value === "number" && Number.isInteger(value) && value >= 0
}

function parsePath(raw: unknown, context: string, invalid: Invalid): JsonPath | undefined {
  if (isRecord(raw)) {
    validateNote(raw, context, invalid)
    raw = raw.path
  }
  if (Array.isArray(raw) && raw.length > 0 && raw.every(isPathSegment)) return raw
  invalid(`${context} must be a non-empty path of strings or non-negative integers`)
  return undefined
}

function parseFields(raw: unknown, invalid: Invalid): ToolOutputFieldPaths | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    invalid("fields must be an object")
    return undefined
  }
  const fields: Partial<Record<ToolOutputField, JsonPath[]>> = {}
  for (const [key, value] of Object.entries(raw)) {
    const field = TOOL_OUTPUT_FIELDS.find((field) => field === key)
    if (!field) {
      invalid(`fields: unknown field "${key}"`)
      continue
    }
    const context = `fields.${field}`
    let paths = value
    if (isRecord(value)) {
      validateNote(value, context, invalid)
      paths = value.paths
    }
    if (!Array.isArray(paths) || paths.length === 0) {
      invalid(`${context} must contain a non-empty list of paths`)
      continue
    }
    const valid = paths.flatMap((path, index) => {
      const parsed = parsePath(path, `${context}[${index}]`, invalid)
      return parsed === undefined ? [] : [parsed]
    })
    if (valid.length > 0) fields[field] = valid
  }
  return Object.keys(fields).length > 0 ? fields : undefined
}

function parseMetaKeys(raw: unknown, invalid: Invalid): ToolOutputMetaKeys | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    invalid("metaKeys must be an object")
    return undefined
  }
  const entries: [string, ToolMetaKeyMode][] = []
  for (const [key, value] of Object.entries(raw)) {
    const context = `metaKeys.${key}`
    if (isRecord(value)) validateNote(value, context, invalid)
    const mode = isRecord(value) ? value.mode : value
    if (
      key.length === 0 ||
      (isRecord(value) && Object.keys(value).some((key) => key !== "mode" && key !== "note"))
    ) {
      invalid(`${context} must have a non-empty key and contain only a mode and optional note`)
      continue
    }
    if (mode !== "append" && mode !== "replace" && mode !== "ignore") {
      invalid(`${context} must classify the key as append, replace or ignore`)
      continue
    }
    entries.push([key, mode])
  }
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

/** Normalizes the configured shapes and leaves cross-field validation to the merged rules. */
export function parseToolOutputMapping(
  raw: unknown,
  invalid: Invalid,
): ToolOutputMappingOverride | undefined {
  if (!isRecord(raw)) {
    invalid("must be an object")
    return undefined
  }
  validateNote(raw, "toolOutput", invalid)
  const fields = parseFields(raw.fields, invalid)
  const metaKeys = parseMetaKeys(raw.metaKeys, invalid)
  if (!fields && !metaKeys) {
    if (raw.fields === undefined && raw.metaKeys === undefined)
      invalid("must include fields or metaKeys")
    return undefined
  }
  return { ...(fields ? { fields } : {}), ...(metaKeys ? { metaKeys } : {}) }
}

/** Fail-open parser for cli-specs override `toolOutput` block. */
export function parseToolOutputOverride(
  kind: string,
  raw: unknown,
): ToolOutputMappingOverride | undefined {
  if (raw === undefined) return undefined
  return parseToolOutputMapping(raw, (reason) => {
    console.warn(`[cli-config-file] override["${kind}"].toolOutput: ${reason}`)
  })
}
