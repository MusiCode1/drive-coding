/**
 * config-resolve.test.ts — TDD for schema + resolveConfig.
 *
 * Covers:
 *  1. precedence: flag > env > file (same field — flag wins)
 *  2. env layer wins over file (flag missing)
 *  3. file layer used when no higher layer sets value
 *  4. object field (log) — override wholesale (not deep merge)
 *  5. object field (voice) — override wholesale
 *  6. cliSpecs — merge per-key across layers
 *  7. invalid field → Err with message
 *  8. empty layer — skipped
 *  9. all layers empty → valid empty config (ok result)
 * 10. https as boolean
 * 11. https as object {key, cert}
 * 12. port must be number (string → Err)
 */

import { describe, expect, it } from "vitest"
import { resolveConfig } from "../src/config/resolve.js"

describe("resolveConfig — precedence", () => {
  it("1. flag > env > file: flag wins when all set", () => {
    const result = resolveConfig([
      { port: 4100 }, // file layer
      { port: 4200 }, // env layer
      { port: 4300 }, // flag layer
    ])
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().port).toBe(4300)
  })

  it("2. env > file: env wins when flag missing", () => {
    const result = resolveConfig([
      { port: 4100 }, // file
      { port: 4200 }, // env (flag absent)
    ])
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().port).toBe(4200)
  })

  it("3. file layer used when no higher layer", () => {
    const result = resolveConfig([{ port: 4100 }])
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().port).toBe(4100)
  })

  it("4. log object — wholesale override (higher layer wins entirely)", () => {
    const result = resolveConfig([
      { log: { level: "debug", ns: "all", format: "pretty" } }, // file
      { log: { level: "info" } }, // env — overrides entire log
    ])
    expect(result.isOk()).toBe(true)
    const cfg = result._unsafeUnwrap()
    expect(cfg.log?.level).toBe("info")
    // ns and format from file layer are gone — wholesale override
    expect(cfg.log?.ns).toBeUndefined()
    expect(cfg.log?.format).toBeUndefined()
  })

  it("5. voice object — wholesale override", () => {
    const result = resolveConfig([
      { voice: { elevenLabsKey: "key1", geminiKey: "gk1" } },
      { voice: { elevenLabsKey: "key2" } }, // env — only sets elevenLabsKey
    ])
    expect(result.isOk()).toBe(true)
    const cfg = result._unsafeUnwrap()
    expect(cfg.voice?.elevenLabsKey).toBe("key2")
    // geminiKey from file layer is gone — wholesale override
    expect(cfg.voice?.geminiKey).toBeUndefined()
  })

  it("6. cliSpecs — merge per-key across layers", () => {
    const result = resolveConfig([
      { cliSpecs: { opencode: { bin: "/file/opencode" }, gemini: { bin: "/file/gemini" } } }, // file
      { cliSpecs: { opencode: { bin: "/env/opencode" } } }, // env — overrides opencode only
      {}, // flag — no cliSpecs
    ])
    expect(result.isOk()).toBe(true)
    const cfg = result._unsafeUnwrap()
    // env wins for opencode
    expect((cfg.cliSpecs?.["opencode"] as { bin: string }).bin).toBe("/env/opencode")
    // gemini from file survives since no higher layer set it
    expect((cfg.cliSpecs?.["gemini"] as { bin: string }).bin).toBe("/file/gemini")
  })

  it("6b. cliSpecs — flag layer overrides per-key", () => {
    const result = resolveConfig([
      { cliSpecs: { opencode: { bin: "/file/opencode" } } },
      {},
      { cliSpecs: { opencode: { bin: "/flag/opencode" } } }, // flag
    ])
    expect(result.isOk()).toBe(true)
    const cfg = result._unsafeUnwrap()
    expect((cfg.cliSpecs?.["opencode"] as { bin: string }).bin).toBe("/flag/opencode")
  })
})

describe("resolveConfig — validation", () => {
  it("7. port as string → Err with validation message", () => {
    // ArkType should reject string for port field
    const result = resolveConfig([{ port: "not-a-number" as unknown as number }])
    expect(result.isErr()).toBe(true)
    const errors = result._unsafeUnwrapErr()
    expect(errors.length).toBeGreaterThan(0)
  })

  it("8. empty layer in middle — skipped cleanly", () => {
    const result = resolveConfig([{ port: 4100 }, {}, {}])
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().port).toBe(4100)
  })

  it("9. all layers empty → valid empty config", () => {
    const result = resolveConfig([{}, {}, {}])
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual({})
  })

  it("10. https as boolean", () => {
    const result = resolveConfig([{ https: true }])
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().https).toBe(true)
  })

  it("11. https as object {key, cert}", () => {
    const result = resolveConfig([{ https: { key: "/path/key.pem", cert: "/path/cert.pem" } }])
    expect(result.isOk()).toBe(true)
    const cfg = result._unsafeUnwrap()
    expect(cfg.https).toEqual({ key: "/path/key.pem", cert: "/path/cert.pem" })
  })
})

describe("resolveConfig — other fields", () => {
  it("corsOrigins as string array", () => {
    const result = resolveConfig([{ corsOrigins: ["http://localhost:3000", "http://localhost:3001"] }])
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().corsOrigins).toEqual(["http://localhost:3000", "http://localhost:3001"])
  })

  it("wireRecord boolean", () => {
    const result = resolveConfig([{ wireRecord: true }])
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().wireRecord).toBe(true)
  })

  it("multiple fields from multiple layers combined", () => {
    const result = resolveConfig([
      { port: 4100, feStaticDir: "/static" }, // file
      { corsOrigins: ["http://example.com"] }, // env
      { opencodeBin: "/custom/opencode" }, // flag
    ])
    expect(result.isOk()).toBe(true)
    const cfg = result._unsafeUnwrap()
    expect(cfg.port).toBe(4100)
    expect(cfg.feStaticDir).toBe("/static")
    expect(cfg.corsOrigins).toEqual(["http://example.com"])
    expect(cfg.opencodeBin).toBe("/custom/opencode")
  })
})
