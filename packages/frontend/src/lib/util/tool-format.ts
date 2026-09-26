import type { ToolContent, ToolLocation } from "$lib/types/bubble"
import type { JsonPath, ToolOutputFieldPaths } from "$lib/types/tool-output"

export type ToolInputView =
  | { kind: "command"; command: string; description?: string }
  | { kind: "code"; code: string; language?: string }
  | { kind: "fields"; fields: { key: string; value: string }[] }
  | { kind: "json"; json: string }
  | { kind: "empty" }

/** @deprecated alias — prefer ToolInputView */
export type FormattedInput = ToolInputView

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function isFlatScalarRecord(obj: Record<string, unknown>): boolean {
  const keys = Object.keys(obj)
  if (keys.length === 0) return false
  return keys.every((k) => {
    const v = obj[k]
    return typeof v === "string" || typeof v === "number" || typeof v === "boolean"
  })
}

/**
 * opencode/bash tools send rawInput = { command, description? }.
 * Prime sends { code } (%%bash → command). Flat scalar objects → fields.
 */
export function formatToolInput(rawInput: unknown): ToolInputView {
  if (rawInput === null || rawInput === undefined) return { kind: "empty" }

  if (isRecord(rawInput)) {
    const obj = rawInput
    if (Object.keys(obj).length === 0) return { kind: "empty" }

    if (typeof obj.command === "string") {
      const view: { kind: "command"; command: string; description?: string } = {
        kind: "command",
        command: obj.command,
      }
      if (typeof obj.description === "string" && obj.description.length > 0) {
        view.description = obj.description
      }
      return view
    }

    if (typeof obj.code === "string") {
      const code = obj.code
      if (code.startsWith("%%bash\n") || code.startsWith("%%bash\r\n")) {
        let body = code.slice("%%bash".length)
        if (body.startsWith("\r\n")) body = body.slice(2)
        else if (body.startsWith("\n")) body = body.slice(1)
        return { kind: "command", command: body.trimStart().trimEnd() }
      }
      return { kind: "code", code, language: "python" }
    }

    if (isFlatScalarRecord(obj)) {
      const fields = Object.keys(obj).map((key) => ({
        key,
        value: String(obj[key]),
      }))
      return { kind: "fields", fields }
    }
  }

  return { kind: "json", json: prettyJson(rawInput) }
}

/** JSON.stringify(value, null, 2) with a fallback to String(value) on cycles. */
export function prettyJson(value: unknown): string {
  // §9.1: if it's a simple object with { output: string }, just return the string
  if (
    typeof value === "object" &&
    value !== null &&
    "output" in value &&
    typeof (value as { output: unknown }).output === "string"
  ) {
    return (value as { output: string }).output
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/** "path:line" or just "path" when no line. */
export function formatLocation(loc: ToolLocation): string {
  if (loc.line !== undefined) {
    return `${loc.path}:${loc.line}`
  }
  return loc.path
}

export type ToolOutputView =
  | { kind: "empty" }
  | { kind: "text"; text: string; exitCode?: number }
  | { kind: "terminal"; stdout: string; stderr: string; exitCode: number }
  | { kind: "error"; message: string }
  | { kind: "stat"; stats: { key: string; value: string }[] }
  | { kind: "json"; json: string }

type MappedScalars = {
  text?: string
  stdout?: string
  stderr?: string
  error?: string
  exitCode?: number
  isError?: boolean
}

function followPath(raw: unknown, path: JsonPath): unknown | undefined {
  let current: unknown = raw
  for (const segment of path) {
    if (typeof segment === "string") {
      if (!isRecord(current)) return undefined
      if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined
      current = current[segment]
      continue
    }
    if (!Array.isArray(current)) return undefined
    if (!Number.isInteger(segment) || segment < 0) return undefined
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined
    current = current[segment]
  }
  return current
}

function extractMappedField(
  raw: unknown,
  paths: readonly JsonPath[] | undefined,
  kind: "string" | "number" | "boolean",
): string | number | boolean | undefined {
  if (!paths) return undefined
  for (const path of paths) {
    const value = followPath(raw, path)
    if (kind === "string" && typeof value === "string") return value
    if (kind === "number" && typeof value === "number" && Number.isFinite(value)) return value
    if (kind === "boolean" && typeof value === "boolean") return value
  }
  return undefined
}

function extractMappedScalars(raw: unknown, mapping: ToolOutputFieldPaths): MappedScalars {
  const result: MappedScalars = {}
  const text = extractMappedField(raw, mapping.text, "string")
  if (text !== undefined) result.text = text
  const stdout = extractMappedField(raw, mapping.stdout, "string")
  if (stdout !== undefined) result.stdout = stdout
  const stderr = extractMappedField(raw, mapping.stderr, "string")
  if (stderr !== undefined) result.stderr = stderr
  const error = extractMappedField(raw, mapping.error, "string")
  if (error !== undefined) result.error = error
  const exitCode = extractMappedField(raw, mapping.exitCode, "number")
  if (exitCode !== undefined) result.exitCode = exitCode
  const isError = extractMappedField(raw, mapping.isError, "boolean")
  if (isError !== undefined) result.isError = isError
  return result
}

function viewFromMappedScalars(raw: unknown, mapped: MappedScalars): ToolOutputView | undefined {
  if (
    mapped.exitCode !== undefined &&
    (mapped.stdout !== undefined || mapped.stderr !== undefined)
  ) {
    return {
      kind: "terminal",
      stdout: mapped.stdout ?? "",
      stderr: mapped.stderr ?? "",
      exitCode: mapped.exitCode,
    }
  }

  if (mapped.error !== undefined) {
    return { kind: "error", message: mapped.error }
  }

  if (mapped.isError === true) {
    const message =
      mapped.text !== undefined && mapped.text.length > 0 ? mapped.text : prettyJson(raw)
    return { kind: "error", message }
  }

  if (mapped.text !== undefined) {
    const view: { kind: "text"; text: string; exitCode?: number } = {
      kind: "text",
      text: mapped.text,
    }
    if (mapped.exitCode !== undefined) view.exitCode = mapped.exitCode
    return view
  }

  return undefined
}

function normalizeToolOutputMapped(
  rawOutput: unknown,
  mapping: ToolOutputFieldPaths,
): ToolOutputView | undefined {
  if (rawOutput === undefined || rawOutput === null || rawOutput === "") {
    return { kind: "empty" }
  }
  const mapped = extractMappedScalars(rawOutput, mapping)
  return viewFromMappedScalars(rawOutput, mapped)
}

function isFlatScalarObject(obj: Record<string, unknown>): boolean {
  const keys = Object.keys(obj)
  if (keys.length === 0) return false
  return keys.every((k) => {
    const v = obj[k]
    return typeof v === "string" || typeof v === "number" || typeof v === "boolean"
  })
}

function joinTextBlocks(content: unknown): string {
  if (!Array.isArray(content)) return ""
  return content
    .filter(
      (item): item is { type: string; text: string } =>
        isRecord(item) && item.type === "text" && typeof item.text === "string",
    )
    .map((item) => item.text)
    .join("\n")
}

/**
 * Maps raw tool output (ACP: intentionally untyped) to a display-ready view.
 * Pure. Never throws. Does not use i18n — the component translates.
 */
export function normalizeToolOutputGeneric(rawOutput: unknown): ToolOutputView {
  if (rawOutput === undefined || rawOutput === null || rawOutput === "") {
    return { kind: "empty" }
  }

  if (typeof rawOutput === "string") {
    return { kind: "text", text: rawOutput }
  }

  if (Array.isArray(rawOutput)) {
    const text = joinTextBlocks(rawOutput)
    if (text) return { kind: "text", text }
    return { kind: "json", json: prettyJson(rawOutput) }
  }

  if (!isRecord(rawOutput)) {
    return { kind: "json", json: prettyJson(rawOutput) }
  }

  const obj = rawOutput

  if (
    typeof obj.exitCode === "number" &&
    (typeof obj.stdout === "string" || typeof obj.stderr === "string")
  ) {
    return {
      kind: "terminal",
      stdout: typeof obj.stdout === "string" ? obj.stdout : "",
      stderr: typeof obj.stderr === "string" ? obj.stderr : "",
      exitCode: obj.exitCode,
    }
  }

  if ("error" in obj && !Array.isArray(obj.content)) {
    const err = obj.error
    const message = typeof err === "string" ? err : prettyJson(err)
    return { kind: "error", message }
  }

  if (obj.isError === true) {
    let message: string
    if (typeof obj.content === "string") {
      message = obj.content
    } else if (Array.isArray(obj.content)) {
      const joined = joinTextBlocks(obj.content)
      message = joined || prettyJson(rawOutput)
    } else {
      message = prettyJson(rawOutput)
    }
    return { kind: "error", message }
  }

  if (typeof obj.content === "string") {
    return { kind: "text", text: obj.content }
  }

  if (Array.isArray(obj.content)) {
    const text = joinTextBlocks(obj.content)
    if (text) return { kind: "text", text }
    return { kind: "json", json: prettyJson(rawOutput) }
  }

  if (typeof obj.output === "string") {
    return { kind: "text", text: obj.output }
  }

  if (Object.keys(obj).length === 0) {
    return { kind: "empty" }
  }

  if (isFlatScalarObject(obj)) {
    const stats = Object.keys(obj).map((key) => ({
      key,
      value: String(obj[key]),
    }))
    return { kind: "stat", stats }
  }

  return { kind: "json", json: prettyJson(rawOutput) }
}

export function normalizeToolOutput(
  rawOutput: unknown,
  mapping?: ToolOutputFieldPaths,
): ToolOutputView {
  if (mapping !== undefined && Object.keys(mapping).length > 0) {
    const mappedView = normalizeToolOutputMapped(rawOutput, mapping)
    if (mappedView !== undefined) return mappedView
  }
  return normalizeToolOutputGeneric(rawOutput)
}
