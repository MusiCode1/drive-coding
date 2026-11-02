/**
 * Facade → SessionCapabilitiesOwner wiring (slice state-agent-session-capabilities-owner).
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const vmPath = fileURLToPath(new URL("./agent-session.svelte.ts", import.meta.url))
const ownerPath = fileURLToPath(new URL("./session-capabilities-owner.ts", import.meta.url))

describe("AgentSession capabilities — source boundary", () => {
  it("facade has no private capability fields", () => {
    const src = readFileSync(vmPath, "utf8")
    expect(src.match(/^ {2}#(?:capabilities|claudeRawSdkMessageCount)\b/m)).toBeNull()
    expect(src.match(/this\.#capabilities\s*=/)).toBeNull()
    expect(src.match(/this\.#claudeRawSdkMessageCount\s*\+?=/)).toBeNull()
  })

  it("facade composes SessionCapabilitiesOwner and keeps forwarders", () => {
    const src = readFileSync(vmPath, "utf8")
    expect(src).toMatch(/#capsOwner = new SessionCapabilitiesOwner\(/)
    for (const name of [
      "capabilities",
      "supports",
      "showsSystemPromptWarning",
      "claudeRawSdkMessageCount",
    ] as const) {
      expect(src).toMatch(new RegExp(`get ${name}\\(\\)[\\s\\S]*?#capsOwner\\.${name}`))
    }
  })

  it("cleanup and HTTP sync delegate to the owner", () => {
    const src = readFileSync(vmPath, "utf8")
    expect(src).toMatch(/#cleanup\([\s\S]*#capsOwner\.reset\(\)/)
    expect(src).toMatch(
      /#syncFromViewState\(viewState: SessionState\)[\s\S]*?#capsOwner\.syncFromHttpView\(/,
    )
  })

  it("reset is called from exactly one site in the facade", () => {
    const src = readFileSync(vmPath, "utf8")
    const matches = src.match(/#capsOwner\.reset\(\)/g) ?? []
    expect(matches).toHaveLength(1)
  })

  it("owner source has no $state (non-reactive contract, bugs/104)", () => {
    const ownerSrc = readFileSync(ownerPath, "utf8")
    expect(ownerSrc).not.toMatch(/\$state/)
  })
})
