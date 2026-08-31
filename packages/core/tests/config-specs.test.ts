/**
 * config-specs.test.ts — TDD for CONFIG_SPECS table + getLeaf/setLeaf helpers.
 */

import { describe, expect, it } from "vitest"
import {
  CONFIG_SPECS,
  type ConfigSpec,
  configDefault,
  getLeaf,
  setLeaf,
} from "../src/config/specs.js"

describe("CONFIG_SPECS — table invariants", () => {
  it("1. exactly 13 entries", () => {
    expect(CONFIG_SPECS).toHaveLength(13)
  })

  it("2. unique key", () => {
    const keys = CONFIG_SPECS.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("3. unique env", () => {
    const envs = CONFIG_SPECS.map((s) => s.env)
    expect(new Set(envs).size).toBe(envs.length)
  })

  it("4. unique flag when present", () => {
    const flags = CONFIG_SPECS.flatMap((s) => (s.flag !== undefined ? [s.flag] : []))
    expect(new Set(flags).size).toBe(flags.length)
  })

  it("4b. product defaults are the agreed numbers (mutation guard)", () => {
    expect(configDefault("port")).toBe(4000)
    expect(configDefault("host")).toBe("127.0.0.1")
    expect(configDefault("rssBudgetMb")).toBe(1500)
    expect(configDefault("httpOwnerTtlMs")).toBe(600_000)
    expect(configDefault("opencodeBin")).toBe("opencode")
  })
})

describe("CONFIG_SPECS — parse/serialize round-trip", () => {
  function specFor(key: ConfigSpec["key"]): ConfigSpec {
    const spec = CONFIG_SPECS.find((s) => s.key === key)
    if (!spec) throw new Error(`missing spec for ${key}`)
    return spec
  }

  it("5a. port round-trip", () => {
    const spec = specFor("port")
    expect(spec.parse?.("4360")).toBe(4360)
    expect(spec.serialize?.(4360)).toBe("4360")
    expect(spec.parse?.(spec.serialize?.(4360) ?? "")).toBe(4360)
  })

  it("5b. corsOrigins round-trip", () => {
    const spec = specFor("corsOrigins")
    const value = ["a", "b"]
    expect(spec.parse?.("a, b")).toEqual(value)
    expect(spec.serialize?.(value)).toBe("a,b")
    expect(spec.parse?.(spec.serialize?.(value) ?? "")).toEqual(value)
  })

  it("5c. wireRecord round-trip", () => {
    const spec = specFor("wireRecord")
    expect(spec.parse?.("1")).toBe(true)
    expect(spec.serialize?.(true)).toBe("1")
    expect(spec.parse?.(spec.serialize?.(true) ?? "")).toBe(true)
    expect(spec.parse?.("0")).toBe(false)
    expect(spec.serialize?.(false)).toBe("0")
    expect(spec.parse?.(spec.serialize?.(false) ?? "")).toBe(false)
  })

  it("5d. rssBudgetMb round-trip", () => {
    const spec = specFor("rssBudgetMb")
    expect(spec.parse?.("2048")).toBe(2048)
    expect(spec.serialize?.(2048)).toBe("2048")
    expect(spec.parse?.(spec.serialize?.(2048) ?? "")).toBe(2048)
    expect(spec.parse?.("not-a-number")).toBeUndefined()
  })

  it("5e. httpOwnerTtlMs round-trip", () => {
    const spec = specFor("httpOwnerTtlMs")
    expect(spec.parse?.("5000")).toBe(5000)
    expect(spec.serialize?.(5000)).toBe("5000")
    expect(spec.parse?.(spec.serialize?.(5000) ?? "")).toBe(5000)
    expect(spec.parse?.("0")).toBeUndefined()
    expect(spec.parse?.("-1")).toBeUndefined()
    expect(spec.parse?.("NaN")).toBeUndefined()
  })
})

describe("CONFIG_SPECS — getLeaf/setLeaf", () => {
  it("6. getLeaf/setLeaf on nested log.ns", () => {
    const cfg: Record<string, unknown> = {}
    setLeaf(cfg, "log.ns", "backend.*")
    expect(getLeaf(cfg, "log.ns")).toBe("backend.*")
    expect(getLeaf(cfg, "log.level")).toBeUndefined()

    setLeaf(cfg, "log.level", "debug")
    expect(getLeaf(cfg, "log.level")).toBe("debug")
    expect(getLeaf(cfg, "log.ns")).toBe("backend.*")
  })
})
