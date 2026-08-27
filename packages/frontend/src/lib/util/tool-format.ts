import type { ToolContent, ToolLocation } from "$lib/types/bubble"

export type FormattedInput =
  | { kind: "command"; command: string }
  | { kind: "json"; json: string }
  | { kind: "empty" }

/**
 * opencode/bash tools send rawInput = { command, description? }.
 * Returns "command" variant when a string `command` field exists,
 * "empty" for {}/null/undefined, else pretty JSON.
 */
export function formatToolInput(rawInput: unknown): FormattedInput {
  if (rawInput === null || rawInput === undefined) return { kind: "empty" }

  if (typeof rawInput === "object") {
    const obj = rawInput as Record<string, unknown>
    if (Object.keys(obj).length === 0) return { kind: "empty" }

    if (typeof obj.command === "string") {
      return { kind: "command", command: obj.command }
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
  | { kind: "text"; text: string }
  | { kind: "terminal"; stdout: string; stderr: string; exitCode: number }
  | { kind: "error"; message: string }
  | { kind: "stat"; stats: { key: string; value: string }[] }
  | { kind: "json"; json: string }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
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

function isFlatScalarObject(obj: Record<string, unknown>): boolean {
  const keys = Object.keys(obj)
  if (keys.length === 0) return false
  return keys.every((k) => {
    const v = obj[k]
    return typeof v === "string" || typeof v === "number" || typeof v === "boolean"
  })
}

/**
 * Maps raw tool output (ACP: intentionally untyped) to a display-ready view.
 * Pure. Never throws. Does not use i18n — the component translates.
 */
export function normalizeToolOutput(rawOutput: unknown): ToolOutputView {
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
