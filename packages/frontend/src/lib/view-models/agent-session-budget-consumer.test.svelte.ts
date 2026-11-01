/**
 * Facade → SessionBudgetOwner wiring (slice state-agent-session-budget-owner).
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { AgentSession } from "./agent-session.svelte"

const vmPath = fileURLToPath(new URL("./agent-session.svelte.ts", import.meta.url))

describe("AgentSession budget — mutation gate", () => {
  it("source pins #budgetOwner.reset inside #cleanup", () => {
    const src = readFileSync(vmPath, "utf8")
    expect(src).toMatch(/#cleanup[\s\S]*this\.#budgetOwner\.reset\(\)/)
  })

  it("facade exposes budget owner without per-field getters", () => {
    const src = readFileSync(vmPath, "utf8")
    expect(src).not.toMatch(/get contextUsage\(\)/)
    expect(src).not.toMatch(/get quota\(\)/)
    expect(src).not.toMatch(/get quotaLoading\(\)/)
    expect(src).toMatch(/readonly budget!: SessionBudgetOwner/)
  })
})

describe("AgentSession budget — consumer reactivity", () => {
  it("nested budget contextUsage is readable on facade", () => {
    const session = new AgentSession()
    session.budget.contextUsage = { used: 10, size: 100, cost: undefined }
    expect(session.budget.contextUsage?.used).toBe(10)
  })
})
