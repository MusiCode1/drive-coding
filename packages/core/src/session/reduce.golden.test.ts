import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { reduce } from "./reduce"
import { createInitialSessionState, type Patch } from "./types"

function loadFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../../tests/fixtures/${name}.json`, import.meta.url), "utf8"),
  )
}

function foldWithoutRules() {
  const frames = loadFixture("codex-terminal-frames") as unknown[]
  let state = createInitialSessionState({ sessionId: "codex-terminal-fixture" })
  const patches: Patch[] = []
  for (const frame of frames) {
    const next = reduce(state, frame)
    state = next.state
    patches.push(...next.patches)
  }
  return { state, patches }
}

describe("tool calls without output rules", () => {
  it("match the captured reducer state and patches", () => {
    expect(foldWithoutRules()).toEqual(loadFixture("codex-terminal-frames.no-policy.golden"))
  })

  it("detects a change to tool output in the golden", () => {
    const golden = loadFixture("codex-terminal-frames.no-policy.golden") as ReturnType<
      typeof foldWithoutRules
    >
    const tool = golden.state.messages.find((message) => message.role === "tool")
    if (!tool) throw new Error("The golden must contain a tool call")
    Object.assign(tool.toolCall, { output: { text: "unexpected" } })
    expect(foldWithoutRules()).not.toEqual(golden)
  })
})
