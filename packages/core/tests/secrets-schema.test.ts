/**
 * secrets-schema.test.ts — TDD for DriveCodingSecrets + SECRET_SPECS consistency.
 */

import { type } from "arktype"
import { describe, expect, it } from "vitest"
import { DriveCodingSecrets, SECRET_SPECS } from "../src/config/secrets.js"

describe("DriveCodingSecrets schema", () => {
  it("accepts both keys", () => {
    const result = DriveCodingSecrets({ elevenLabsKey: "a", geminiKey: "b" })
    expect(result instanceof type.errors).toBe(false)
  })

  it("accepts empty object", () => {
    const result = DriveCodingSecrets({})
    expect(result instanceof type.errors).toBe(false)
  })

  it("rejects non-string value", () => {
    const result = DriveCodingSecrets({ elevenLabsKey: 123 })
    expect(result instanceof type.errors).toBe(true)
  })
})

describe("SECRET_SPECS consistency", () => {
  it("covers exactly the schema keys", () => {
    const specKeys = SECRET_SPECS.map((s) => s.key)
    expect(specKeys.sort()).toEqual(["elevenLabsKey", "geminiKey"])
    for (const spec of SECRET_SPECS) {
      const result = DriveCodingSecrets({ [spec.key]: "PLACEHOLDER" })
      expect(result instanceof type.errors).toBe(false)
    }
  })
})
