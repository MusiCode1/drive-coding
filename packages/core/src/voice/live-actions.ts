/**
 * live-actions.ts — action shapes only (no prose).
 *
 * Slice: live-contract-gemini, Commit 0.
 * Descriptions the model reads live in live-prompt.ts (lint:i18n allowlist).
 */

import { LIVE_ACTION_PROSE } from "./live-prompt.js"

export interface LiveActionParam {
  name: string
  type: "string" | "number" | "boolean"
  required: boolean
  enumValues?: readonly string[]
}

/** Action structure. Model-facing descriptions live in live-prompt.ts. */
export interface LiveActionShape {
  name: string
  params: readonly LiveActionParam[]
}

/** Full action — structure + prose after merge. */
export interface LiveActionSpec extends LiveActionShape {
  description: string
  params: readonly (LiveActionParam & { description: string })[]
}

export const LIVE_ACTION_SHAPES: readonly LiveActionShape[] = [
  {
    name: "compose_prompt",
    params: [{ name: "text", type: "string", required: true }],
  },
  { name: "forward", params: [] },
  { name: "cancel_turn", params: [] },
  { name: "pause_live", params: [] },
  { name: "close_live", params: [] },
  {
    name: "answer_permission",
    params: [{ name: "optionId", type: "string", required: true }],
  },
  {
    name: "search_session",
    params: [{ name: "query", type: "string", required: true }],
  },
  {
    name: "read_recent",
    params: [
      { name: "count", type: "number", required: false },
      { name: "thoughts", type: "boolean", required: false },
      { name: "toolCalls", type: "boolean", required: false },
      { name: "messages", type: "boolean", required: false },
    ],
  },
  {
    name: "remember_session",
    params: [
      { name: "text", type: "string", required: true },
      { name: "id", type: "string", required: false },
    ],
  },
  {
    name: "remember_always",
    params: [
      { name: "text", type: "string", required: true },
      { name: "id", type: "string", required: false },
    ],
  },
  { name: "list_config", params: [] },
  {
    name: "set_session_config",
    params: [
      { name: "id", type: "string", required: true },
      { name: "value", type: "string", required: true },
    ],
  },
  {
    name: "set_app_setting",
    params: [
      { name: "key", type: "string", required: true },
      { name: "value", type: "string", required: true },
    ],
  },
]

/**
 * Merges structure + prose into the full action surface.
 * Unknown names in `names` are skipped silently; omit `names` for all.
 */
export function buildLiveActions(names?: readonly string[]): readonly LiveActionSpec[] {
  const allowed =
    names === undefined
      ? LIVE_ACTION_SHAPES
      : LIVE_ACTION_SHAPES.filter((s) => names.includes(s.name))

  return allowed.map((shape) => {
    const prose = LIVE_ACTION_PROSE[shape.name]
    if (!prose) {
      throw new Error(`Missing prose for action: ${shape.name}`)
    }
    return {
      name: shape.name,
      description: prose.description,
      params: shape.params.map((p) => ({
        ...p,
        description: prose.params[p.name] ?? "",
      })),
    }
  })
}
