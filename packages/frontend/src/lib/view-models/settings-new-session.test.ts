/**
 * settings-new-session.test.ts — the middle link of the locked `/new` cwd chain.
 *
 * The negative cases are the point. `pre-brief-chat-new-open-routes.md` §7#1 forbids a
 * silent spawn on a guess, so anything that is not an explicit absolute path must resolve
 * to `null` and send the user to the picker — never to a joined-up folder they did not
 * name.
 */

import { describe, expect, it } from "vitest"
import { isAbsoluteProjectPath, resolveDefaultNewCwd } from "./settings-new-session.js"

describe("resolveDefaultNewCwd", () => {
  it("accepts an absolute path", () => {
    expect(resolveDefaultNewCwd("/home/u/Projects/app")).toBe("/home/u/Projects/app")
  })

  it("trims before deciding", () => {
    expect(resolveDefaultNewCwd("  /home/u/app  ")).toBe("/home/u/app")
  })

  it("unset, empty and whitespace all mean 'show the picker'", () => {
    expect(resolveDefaultNewCwd(undefined)).toBeNull()
    expect(resolveDefaultNewCwd(null)).toBeNull()
    expect(resolveDefaultNewCwd("")).toBeNull()
    expect(resolveDefaultNewCwd("   ")).toBeNull()
  })

  it("🛑 rejects a relative path rather than joining it to the home directory", () => {
    // Joining would be the "spawn on a guess" the locked decision forbids: the user
    // names Projects/app and silently lands in ~/Projects/app.
    expect(resolveDefaultNewCwd("Projects/app")).toBeNull()
    expect(resolveDefaultNewCwd("./app")).toBeNull()
    expect(resolveDefaultNewCwd("~/Projects/app")).toBeNull()
  })

  it("rejects a percent-encoded path, like the deep link does", () => {
    expect(resolveDefaultNewCwd("%2Fhome%2Fu%2Fapp")).toBeNull()
  })

  it("accepts Windows shapes", () => {
    expect(resolveDefaultNewCwd("C:/Users/you/app")).toBe("C:/Users/you/app")
    expect(resolveDefaultNewCwd("C:\\Users\\you\\app")).toBe("C:\\Users\\you\\app")
    expect(resolveDefaultNewCwd("\\\\server\\share")).toBe("\\\\server\\share")
  })
})

describe("isAbsoluteProjectPath", () => {
  it("matches the deep-link classifier, so the two cannot drift apart", () => {
    for (const p of ["/a", "C:/a", "C:\\a", "\\\\host\\s"]) {
      expect(isAbsoluteProjectPath(p)).toBe(true)
    }
    for (const p of ["a", "./a", "~/a", "", "   "]) {
      expect(isAbsoluteProjectPath(p)).toBe(false)
    }
  })
})
