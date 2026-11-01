/**
 * Facade → SessionConfigOwner wiring (slice state-agent-session-config-owner).
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const vmPath = fileURLToPath(new URL("./agent-session.svelte.ts", import.meta.url))
const FACADE_CONFIG_MEMBER =
  /^ {2}(?:readonly |declare )?(?:get |set )?(?:configOptions|models|modes)\b/m

describe("AgentSession config — source boundary", () => {
  it("source pins config writes through SessionConfigOwner in #syncFromViewState", () => {
    const src = readFileSync(vmPath, "utf8")
    expect(src).toMatch(/#syncFromViewState[\s\S]*this\.config\.syncFromHttpView\(/)
  })

  it("facade exposes config owner without class-level config field mirrors", () => {
    const src = readFileSync(vmPath, "utf8")
    expect(src).toMatch(/readonly config = new SessionConfigOwner\(\)/)
    expect(src.match(FACADE_CONFIG_MEMBER)).toBeNull()
  })
})

describe("AgentSession config — cleanup boundary", () => {
  it("source does not reset config inside #cleanup", () => {
    const src = readFileSync(vmPath, "utf8")
    const cleanupBlock = src.match(/#cleanup\([\s\S]*?\n {2}\}/)?.[0] ?? ""
    expect(cleanupBlock).not.toMatch(/config\.configOptions\s*=/)
    expect(cleanupBlock).not.toMatch(/config\.models\s*=/)
    expect(cleanupBlock).not.toMatch(/config\.modes\s*=/)
    expect(cleanupBlock).not.toMatch(/#configOwner\.reset/)
  })
})
