import { describe, expect, it } from "vitest"
import {
  MCP_CONFIGURE_HINT,
  MCP_SERVER_DESCRIPTION,
  MCP_SERVER_INSTRUCTIONS,
  MCP_TOOL_META,
  MCP_NOTIFY_PARENT_META,
} from "@drive-coding/core"
import { buildSurfacePrompt, type SurfaceRuntimeInfo } from "../index.js"
import { TIER2_BUDGET_CHARS } from "./tier2-budget.js"

const FIXTURE_RUNTIME: SurfaceRuntimeInfo = {
  baseUrl: "http://127.0.0.1:4021",
  port: 4021,
  pid: 12345,
  agentId: "00000000-0000-0000-0000-000000000000",
}

function toolCatalogChars(): number {
  const entries: Array<[string, { title: string; description: string }]> = [
    ...Object.entries(MCP_TOOL_META),
    ["notify_parent", MCP_NOTIFY_PARENT_META],
  ]
  return entries.reduce((s, [name, v]) => s + name.length + v.title.length + v.description.length, 0)
}

describe("tier2 surface + MCP catalog budget", () => {
  it("stays within TIER2_BUDGET_CHARS with fixed runtime fixture", () => {
    const surface = buildSurfacePrompt({
      pieces: ["about", "runtime", "capabilities", "display"],
      runtime: FIXTURE_RUNTIME,
    })
    const total =
      MCP_SERVER_INSTRUCTIONS.length +
      toolCatalogChars() +
      MCP_SERVER_DESCRIPTION.length +
      MCP_CONFIGURE_HINT.length +
      surface.length

    // Measured 2026-09-28 on slice/agent-docs-serve: total=12,336 (baseline 12,141).
    expect(total).toBeLessThanOrEqual(TIER2_BUDGET_CHARS)
    expect(total).toBeGreaterThan(9_000)
  })
})
