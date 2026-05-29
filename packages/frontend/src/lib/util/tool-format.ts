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
