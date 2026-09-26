import defaultsJson from "./tool-output-mappings.json" with { type: "json" }
import { loadCliSpecsOverride } from "./cli-config-file.js"
import {
  type DefaultToolOutputMapping,
  type EffectiveToolOutputMapping,
  type ToolOutputFieldPaths,
  type ToolOutputMappingsProjection,
  type VerifiedAgainst,
  TOOL_OUTPUT_FIELDS,
} from "./tool-output-field-types.js"
import { validateFieldPathsFromOverride } from "./tool-output-override-parse.js"

export {
  TOOL_OUTPUT_FIELDS,
  type DefaultToolOutputMapping,
  type EffectiveToolOutputMapping,
  type JsonPath,
  type JsonPathSegment,
  type ToolOutputField,
  type ToolOutputFieldPaths,
  type ToolOutputMappingOverride,
  type ToolOutputMappingsProjection,
  type VerifiedAgainst,
} from "./tool-output-field-types.js"

function validateVerifiedAgainst(raw: unknown, context: string): VerifiedAgainst {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`[tool-output-mappings] ${context}.verifiedAgainst must be an object`)
  }
  const obj = raw as Record<string, unknown>
  if (typeof obj["bridge"] !== "string" || obj["bridge"].length === 0) {
    throw new Error(`[tool-output-mappings] ${context}.verifiedAgainst.bridge must be a non-empty string`)
  }
  if (typeof obj["version"] !== "string" || obj["version"].length === 0) {
    throw new Error(`[tool-output-mappings] ${context}.verifiedAgainst.version must be a non-empty string`)
  }
  return { bridge: obj["bridge"], version: obj["version"] }
}

function validateDefaultEntry(
  kind: string,
  raw: unknown,
): DefaultToolOutputMapping {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`[tool-output-mappings] defaults["${kind}"] must be an object`)
  }
  const obj = raw as Record<string, unknown>
  const verifiedAgainst = validateVerifiedAgainst(obj["verifiedAgainst"], `defaults["${kind}"]`)
  const fields = validateFieldPathsFromOverride(obj["fields"], kind, true)
  if (fields === null) {
    throw new Error(`[tool-output-mappings] defaults["${kind}"].fields is invalid`)
  }
  return { verifiedAgainst, fields }
}

function loadValidatedDefaults(): Readonly<Record<string, DefaultToolOutputMapping>> {
  if (typeof defaultsJson !== "object" || defaultsJson === null || Array.isArray(defaultsJson)) {
    throw new Error("[tool-output-mappings] tool-output-mappings.json must be a JSON object")
  }
  const result: Record<string, DefaultToolOutputMapping> = {}
  for (const [kind, value] of Object.entries(defaultsJson as Record<string, unknown>)) {
    result[kind] = validateDefaultEntry(kind, value)
  }
  return result
}

const DEFAULT_MAPPINGS = loadValidatedDefaults()

function mergeFields(
  base: ToolOutputFieldPaths,
  override: ToolOutputFieldPaths,
): ToolOutputFieldPaths {
  return { ...base, ...override }
}

function collectAllKinds(
  defaults: Readonly<Record<string, DefaultToolOutputMapping>>,
  overrides: ReturnType<typeof loadCliSpecsOverride>,
): string[] {
  const kinds = new Set<string>(Object.keys(defaults))
  for (const kind of Object.keys(overrides)) {
    if (overrides[kind]?.toolOutput !== undefined) kinds.add(kind)
  }
  return [...kinds]
}

export function getEffectiveToolOutputMappings(
  env?: NodeJS.ProcessEnv,
): Readonly<Record<string, EffectiveToolOutputMapping>> {
  const overrides = loadCliSpecsOverride(env)
  const result: Record<string, EffectiveToolOutputMapping> = {}

  for (const kind of collectAllKinds(DEFAULT_MAPPINGS, overrides)) {
    const defaultEntry = DEFAULT_MAPPINGS[kind]
    const overrideEntry = overrides[kind]?.toolOutput

    const baseFields: ToolOutputFieldPaths = defaultEntry?.fields ?? {}
    const overrideFields = overrideEntry?.fields ?? {}
    const fields = mergeFields(baseFields, overrideFields)

    if (Object.keys(fields).length === 0 && defaultEntry === undefined) {
      continue
    }

    result[kind] = {
      ...(defaultEntry?.verifiedAgainst !== undefined
        ? { verifiedAgainst: defaultEntry.verifiedAgainst }
        : {}),
      fields,
    }
  }

  return result
}

export function getToolOutputMappingsProjection(
  env?: NodeJS.ProcessEnv,
): ToolOutputMappingsProjection {
  const effective = getEffectiveToolOutputMappings(env)
  const projection: Record<string, ToolOutputFieldPaths> = {}
  for (const [kind, mapping] of Object.entries(effective)) {
    projection[kind] = mapping.fields
  }
  return projection
}

/** @internal — tests only */
export function getDefaultMappingsForTest(): Readonly<Record<string, DefaultToolOutputMapping>> {
  return DEFAULT_MAPPINGS
}
