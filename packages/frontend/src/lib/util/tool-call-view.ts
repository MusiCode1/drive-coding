import type { ToolCall, ToolContent, ToolLocation } from "$lib/types/bubble"
import {
  formatToolInput,
  normalizeToolOutput,
  type ToolInputView,
  type ToolOutputView,
} from "./tool-format"

export type SummarySource =
  | "narration"
  | "description"
  | "title"
  | "input-extract"
  | "kind"
  | "empty"

export type ToolCallView = {
  id: string
  status: ToolCall["status"]
  kind?: string
  technicalTitle?: string
  summary: string
  summarySource: SummarySource
  input: ToolInputView
  output: ToolOutputView
  richContent: ToolContent[]
  locations: ToolLocation[]
  hasDetails: boolean
}

export type NormalizeToolContext = {
  narration?: string
}

const GENERIC_TITLES = new Set([
  "Terminal",
  "ipython",
  "IPython cell",
  "Bash",
  "Read",
  "Write",
  "Edit",
  "Grep",
  "Glob",
  "Shell",
  "Task",
])

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function firstNonEmptyLine(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed) return trimmed
  }
  return ""
}

function basename(path: string): string {
  const parts = path.split(/[/\\]/)
  return parts[parts.length - 1] ?? path
}

function argsDescription(args: unknown): string | undefined {
  if (!isRecord(args)) return undefined
  const desc = args.description
  if (typeof desc === "string" && desc.length > 0) return desc
  return undefined
}

function extractFromFields(fields: { key: string; value: string }[]): string {
  const patternField = fields.find(
    (f) => f.key === "pattern" || f.key === "glob" || f.key === "query",
  )
  const pathField = fields.find((f) => f.key === "path")

  if (patternField) {
    let result = patternField.value
    if (pathField) {
      result += ` ${basename(pathField.value)}`
    }
    return result
  }

  const first = fields[0]
  if (first) return `${first.key}: ${first.value}`
  return ""
}

function extractFromInput(input: ToolInputView): string {
  switch (input.kind) {
    case "command":
      return firstNonEmptyLine(input.command)
    case "code":
      return firstNonEmptyLine(input.code)
    case "fields":
      return extractFromFields(input.fields)
    default:
      return ""
  }
}

/** Whether an ACP title is human-readable (action+path, Find, etc.) vs generic/command echo. */
export function isHumanTitle(title: string): boolean {
  if (!title) return false
  if (GENERIC_TITLES.has(title)) return false
  if (/^(cd |git |python|echo |`)/.test(title)) return false
  if (/^(Read|Edit|Write|Delete) [`/]/.test(title)) return true
  if (title.startsWith("Find ")) return true
  if (title.startsWith("Update TODOs")) return true
  if (title.startsWith("Task:")) return true
  if (title.includes(" ") && title.length > 12) return true
  return false
}

export function pickSummary(
  tc: ToolCall,
  input: ToolInputView,
  ctx?: NormalizeToolContext,
): { summary: string; summarySource: SummarySource } {
  const narration = ctx?.narration ?? tc.narration
  if (typeof narration === "string" && narration.length > 0) {
    return { summary: narration, summarySource: "narration" }
  }

  if (input.kind === "command" && input.description) {
    return { summary: input.description, summarySource: "description" }
  }

  const desc = argsDescription(tc.args)
  if (desc) {
    return { summary: desc, summarySource: "description" }
  }

  const title = tc.title
  if (title && isHumanTitle(title)) {
    return { summary: title, summarySource: "title" }
  }

  const extracted = extractFromInput(input)
  if (extracted) {
    return { summary: extracted, summarySource: "input-extract" }
  }

  if (title && title.length > 0) {
    return { summary: title, summarySource: "title" }
  }

  const kindFallback = tc.kind ?? tc.name ?? "tool"
  if (kindFallback) {
    return { summary: kindFallback, summarySource: "kind" }
  }

  return { summary: "", summarySource: "empty" }
}

export function normalizeToolCall(
  tc: ToolCall,
  ctx?: NormalizeToolContext,
): ToolCallView {
  const input = formatToolInput(tc.args)
  const output = normalizeToolOutput(tc.result)
  const richContent = tc.content ?? []
  const locations = tc.locations ?? []
  const { summary, summarySource } = pickSummary(tc, input, ctx)

  const hasDetails =
    input.kind !== "empty" ||
    output.kind !== "empty" ||
    richContent.length > 0 ||
    locations.length > 0

  return {
    id: tc.toolCallId,
    status: tc.status,
    kind: tc.kind,
    technicalTitle: tc.title ?? tc.name,
    summary,
    summarySource,
    input,
    output,
    richContent,
    locations,
    hasDetails,
  }
}
