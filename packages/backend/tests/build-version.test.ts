import { describe, expect, it } from "vitest"
import { buildVersion } from "../src/binary.js"

describe("buildVersion()", () => {
  it("returns undefined in dev/test (no __BUILD_VERSION__ define)", () => {
    // In dev/test env, __BUILD_VERSION__ is not defined by Bun → must return undefined.
    // The ?? fallback in drive-coding.ts and app-version.ts will then read from disk.
    expect(buildVersion()).toBeUndefined()
  })
})
