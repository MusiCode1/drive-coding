export const TOOL_OUTPUT_FIELDS = [
  "text",
  "exitCode",
  "stdout",
  "stderr",
  "error",
  "isError",
] as const
export type ToolOutputField = (typeof TOOL_OUTPUT_FIELDS)[number]
const TEXT_FIELDS = ["text", "stdout", "stderr", "error"] as const
export type ToolOutputTextField = (typeof TEXT_FIELDS)[number]

export type ToolOutput = {
  readonly text?: string
  readonly stdout?: string
  readonly stderr?: string
  readonly error?: string
  readonly exitCode?: number
  readonly isError?: boolean
  /** At least one text field exceeded the cap at some point in this tool call. */
  readonly truncated?: true
}

export type JsonPath = readonly (string | number)[]
export type ToolOutputSource =
  | { readonly from: "raw"; readonly path: JsonPath }
  | { readonly from: "meta"; readonly key: string; readonly path: JsonPath }
export type ToolMetaKeyMode = "append" | "replace" | "ignore"
export type ToolOutputRules = {
  readonly fields: Partial<Readonly<Record<ToolOutputField, readonly ToolOutputSource[]>>>
  readonly metaKeys: Readonly<Record<string, ToolMetaKeyMode>>
}
export type ReduceOptions = { readonly toolOutput?: ToolOutputRules }

export const TOOL_OUTPUT_META_KEY = "_drive/toolOutput"
export const TOOL_OUTPUT_TEXT_CAP = 65_536

type SetFields = Omit<ToolOutput, "truncated">
type AppendFields = Partial<Record<ToolOutputTextField, string>>
type Rank = Partial<Record<ToolOutputField, number>>

export type ToolOutputDelta = {
  readonly set?: SetFields
  readonly append?: AppendFields
  readonly truncated?: true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function followPath(raw: unknown, path: JsonPath): unknown | undefined {
  let current: unknown = raw
  for (const segment of path) {
    if (typeof segment === "string") {
      if (!isRecord(current)) return undefined
      if (!Object.hasOwn(current, segment)) return undefined
      current = current[segment]
      continue
    }
    if (!Array.isArray(current)) return undefined
    if (!Number.isInteger(segment) || segment < 0) return undefined
    if (!Object.hasOwn(current, segment)) return undefined
    current = current[segment]
  }
  return current
}

function isFieldValue(field: ToolOutputField, value: unknown): value is string | number | boolean {
  if (field === "exitCode") return typeof value === "number" && Number.isFinite(value)
  if (field === "isError") return typeof value === "boolean"
  return typeof value === "string"
}

function capTail(text: string): string {
  return text.length > TOOL_OUTPUT_TEXT_CAP ? text.slice(-TOOL_OUTPUT_TEXT_CAP) : text
}

function makeDelta(
  set: SetFields,
  append: AppendFields,
  truncated: boolean,
): ToolOutputDelta | undefined {
  const hasSet = Object.keys(set).length > 0
  const hasAppend = Object.keys(append).length > 0
  if (!hasSet && !hasAppend && !truncated) return undefined
  return {
    ...(hasSet ? { set } : {}),
    ...(hasAppend ? { append } : {}),
    ...(truncated ? { truncated: true } : {}),
  }
}

export function parseToolOutputDelta(raw: unknown): ToolOutputDelta | undefined {
  if (!isRecord(raw)) return undefined
  const set: SetFields = {}
  const append: AppendFields = {}
  if (isRecord(raw.set)) {
    for (const field of TOOL_OUTPUT_FIELDS) {
      const value = raw.set[field]
      if (isFieldValue(field, value)) Object.assign(set, { [field]: value })
    }
  }
  if (isRecord(raw.append)) {
    for (const field of TEXT_FIELDS) {
      const value = raw.append[field]
      if (typeof value === "string") append[field] = value
    }
  }
  return makeDelta(set, append, raw.truncated === true)
}

export function applyToolOutputDelta(
  output: ToolOutput | undefined,
  delta: ToolOutputDelta,
): ToolOutput {
  const next = { ...output, ...delta.set }
  if (delta.truncated) next.truncated = true
  for (const field of TEXT_FIELDS) {
    const base = next[field]
    const chunk = delta.append?.[field]
    if (base === undefined && chunk === undefined) continue
    const text = chunk === undefined ? (base ?? "") : (base ?? "") + chunk
    if (text.length > TOOL_OUTPUT_TEXT_CAP) next.truncated = true
    next[field] = capTail(text)
  }
  return next
}

type OutputFrame = { rawOutput?: unknown; hasRawOutput: boolean; meta?: Record<string, unknown> }

function readSource(source: ToolOutputSource, frame: OutputFrame): unknown {
  if (source.from === "raw") {
    return frame.hasRawOutput ? followPath(frame.rawOutput, source.path) : undefined
  }
  if (!frame.meta || !Object.hasOwn(frame.meta, source.key)) return undefined
  return followPath(frame.meta[source.key], source.path)
}

export function deriveToolOutputDelta(
  prev: { output?: ToolOutput; rank?: Rank },
  frame: OutputFrame,
  rules: ToolOutputRules,
): { delta: ToolOutputDelta | undefined; output: ToolOutput | undefined; rank: Rank } {
  const set: SetFields = {}
  const append: AppendFields = {}
  const rank: Rank = { ...prev.rank }
  let cappedSet = false

  for (const field of TOOL_OUTPUT_FIELDS) {
    const sources = rules.fields[field]
    if (!sources) continue
    const current = rank[field] ?? Infinity
    for (const [index, source] of sources.entries()) {
      if (index > current) break
      const value = readSource(source, frame)
      if (!isFieldValue(field, value)) continue
      if (
        typeof value === "string" &&
        field !== "exitCode" &&
        field !== "isError" &&
        index === current &&
        source.from === "meta" &&
        rules.metaKeys[source.key] === "append"
      ) {
        append[field] = value
      } else {
        const bounded = typeof value === "string" ? capTail(value) : value
        cappedSet ||= bounded !== value
        Object.assign(set, { [field]: bounded })
        rank[field] = index
      }
      break
    }
  }

  const delta = makeDelta(set, append, cappedSet && prev.output?.truncated !== true)
  if (!delta) return { delta, output: prev.output, rank }
  const output = applyToolOutputDelta(prev.output, delta)
  const newlyTruncated = output.truncated === true && prev.output?.truncated !== true
  return { delta: newlyTruncated ? { ...delta, truncated: true } : delta, output, rank }
}

export function unclassifiedToolMetaKeys(rules: ToolOutputRules, update: unknown): string[] {
  if (!isRecord(update)) return []
  if (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update") return []
  if (!isRecord(update._meta)) return []
  return Object.keys(update._meta).filter(
    (key) => !key.startsWith("_drive/") && !Object.hasOwn(rules.metaKeys, key),
  )
}
