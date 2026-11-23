import type { ToolOutputRules, ToolOutputSource } from "@drive-coding/core/session"
import { type CliSpecsOverride, loadCliSpecsOverride } from "./cli-config-file.js"
import {
  type DefaultToolOutputMapping,
  type EffectiveToolOutputMapping,
  type JsonPath,
  META_ROOT,
  TOOL_OUTPUT_FIELDS,
  type ToolOutputField,
  type ToolOutputMetaKeys,
  type VerifiedAgainst,
} from "./tool-output-field-types.js"
import defaultsJson from "./tool-output-mappings.json" with { type: "json" }
import { parseToolOutputMapping } from "./tool-output-override-parse.js"

export {
  type DefaultToolOutputMapping,
  type EffectiveToolOutputMapping,
  type JsonPath,
  type JsonPathSegment,
  TOOL_OUTPUT_FIELDS,
  type ToolOutputField,
  type ToolOutputFieldPaths,
  type ToolOutputMappingOverride,
  type VerifiedAgainst,
} from "./tool-output-field-types.js"

function validateVerifiedAgainst(raw: unknown, context: string): VerifiedAgainst {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`[tool-output-mappings] ${context}.verifiedAgainst must be an object`)
  }
  const obj = raw as Record<string, unknown>
  if (typeof obj.bridge !== "string" || obj.bridge.length === 0) {
    throw new Error(
      `[tool-output-mappings] ${context}.verifiedAgainst.bridge must be a non-empty string`,
    )
  }
  if (typeof obj.version !== "string" || obj.version.length === 0) {
    throw new Error(
      `[tool-output-mappings] ${context}.verifiedAgainst.version must be a non-empty string`,
    )
  }
  return { bridge: obj.bridge, version: obj.version }
}

function compilePath(
  field: ToolOutputField,
  path: JsonPath,
  metaKeys: ToolOutputMetaKeys,
): ToolOutputSource | undefined {
  if (!path.includes(META_ROOT)) return { from: "raw", path }
  const [root, key, ...rest] = path
  if (
    root !== META_ROOT ||
    typeof key !== "string" ||
    key === META_ROOT ||
    rest.includes(META_ROOT)
  ) {
    return undefined
  }
  const mode = Object.hasOwn(metaKeys, key) ? metaKeys[key] : undefined
  if (mode === "replace" || (mode === "append" && field !== "exitCode" && field !== "isError")) {
    return { from: "meta", key, path: rest }
  }
  return undefined
}

function compileRules(
  mapping: EffectiveToolOutputMapping,
  invalid: (field: ToolOutputField, path: JsonPath) => void,
): ToolOutputRules {
  const fields: Partial<Record<ToolOutputField, ToolOutputSource[]>> = {}
  const metaKeys = mapping.metaKeys ?? {}
  for (const field of TOOL_OUTPUT_FIELDS) {
    const paths = mapping.fields[field]
    if (!paths) continue
    const sources: ToolOutputSource[] = []
    for (const path of paths) {
      const source = compilePath(field, path, metaKeys)
      if (source) sources.push(source)
      else invalid(field, path)
    }
    if (sources.length > 0) fields[field] = sources
  }
  return { fields, metaKeys }
}

function validateDefaultEntry(kind: string, raw: unknown): DefaultToolOutputMapping {
  const context = `[tool-output-mappings] defaults["${kind}"]`
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${context} must be an object`)
  }
  const obj = raw as Record<string, unknown>
  const verifiedAgainst = validateVerifiedAgainst(obj.verifiedAgainst, context)
  const normalized = parseToolOutputMapping(obj, (reason) => {
    throw new Error(`${context}: ${reason}`)
  })
  if (!normalized) throw new Error(`${context} must have valid fields or metaKeys`)
  const mapping = { verifiedAgainst, ...normalized, fields: normalized.fields ?? {} }
  compileRules(mapping, (field, path) => {
    throw new Error(`${context}.fields.${field}: invalid ${META_ROOT} path ${JSON.stringify(path)}`)
  })
  return mapping
}

function loadValidatedDefaults(): Readonly<Record<string, DefaultToolOutputMapping>> {
  if (typeof defaultsJson !== "object" || defaultsJson === null || Array.isArray(defaultsJson)) {
    throw new Error("[tool-output-mappings] tool-output-mappings.json must be a JSON object")
  }
  return Object.fromEntries(
    Object.entries(defaultsJson).map(([kind, value]) => [kind, validateDefaultEntry(kind, value)]),
  )
}

const DEFAULT_MAPPINGS = loadValidatedDefaults()
const warnedPaths = new WeakMap<CliSpecsOverride, Set<string>>()

function getEffectiveMapping(
  kind: string,
  overrides: CliSpecsOverride,
): EffectiveToolOutputMapping | undefined {
  const base = Object.hasOwn(DEFAULT_MAPPINGS, kind) ? DEFAULT_MAPPINGS[kind] : undefined
  const override = Object.hasOwn(overrides, kind) ? overrides[kind]?.toolOutput : undefined
  if (!base && !override) return undefined
  const metaKeys = { ...base?.metaKeys, ...override?.metaKeys }
  return {
    ...(base ? { verifiedAgainst: base.verifiedAgainst } : {}),
    fields: { ...base?.fields, ...override?.fields },
    ...(Object.keys(metaKeys).length > 0 ? { metaKeys } : {}),
  }
}

export function getEffectiveToolOutputMappings(
  env?: NodeJS.ProcessEnv,
): Readonly<Record<string, EffectiveToolOutputMapping>> {
  const overrides = loadCliSpecsOverride(env)
  const kinds = new Set([...Object.keys(DEFAULT_MAPPINGS), ...Object.keys(overrides)])
  return Object.fromEntries(
    [...kinds].flatMap((kind) => {
      const mapping = getEffectiveMapping(kind, overrides)
      return mapping ? [[kind, mapping] as const] : []
    }),
  )
}

export function getToolOutputRules(
  cliKind: string,
  env?: NodeJS.ProcessEnv,
): ToolOutputRules | undefined {
  const overrides = loadCliSpecsOverride(env)
  const mapping = getEffectiveMapping(cliKind, overrides)
  if (!mapping) return undefined
  return compileRules(mapping, (field, path) => {
    const warned = warnedPaths.get(overrides) ?? new Set<string>()
    const pathText = JSON.stringify(path)
    const key = JSON.stringify([cliKind, path])
    if (warned.has(key)) return
    warned.add(key)
    warnedPaths.set(overrides, warned)
    console.warn(
      `[tool-output-mappings] override["${cliKind}"].fields.${field}: invalid ${META_ROOT} path ${pathText}`,
    )
  })
}

/** @internal — tests only */
export function getDefaultMappingsForTest(): Readonly<Record<string, DefaultToolOutputMapping>> {
  return DEFAULT_MAPPINGS
}
