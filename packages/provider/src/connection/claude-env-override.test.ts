/**
 * claude-env-override.test.ts — TDD for buildClaudeEnvOverride + injectEnvOverride.
 *
 * buildClaudeEnvOverride: translates CliSpec.unsetEnv/setEnv into an SDK env-override object.
 * injectEnvOverride: merges envOverride into params._meta.claudeCode.options.env.
 *
 * Key invariant: unset is represented as key-with-undefined-value (Node drops it on spawn).
 * The "in" check (key in result) verifies presence without value, distinct from absence.
 */
import { describe, expect, it } from "vitest"
import type { CliSpec } from "@drive-coding/core"
import { buildClaudeEnvOverride, injectEnvOverride } from "./claude-env-override.js"

// ---------------------------------------------------------------------------
// buildClaudeEnvOverride
// ---------------------------------------------------------------------------

describe("buildClaudeEnvOverride", () => {
  it("returns undefined when spec is undefined", () => {
    expect(buildClaudeEnvOverride(undefined)).toBeUndefined()
  })

  it("returns undefined when spec has no unsetEnv and no setEnv", () => {
    const spec: CliSpec = {
      bin: "claude",
      args: [],
      supportsModelFlag: false,
    }
    expect(buildClaudeEnvOverride(spec)).toBeUndefined()
  })

  it("returns undefined when spec has empty unsetEnv and empty setEnv", () => {
    const spec: CliSpec = {
      bin: "claude",
      args: [],
      supportsModelFlag: false,
      unsetEnv: [],
      setEnv: {},
    }
    expect(buildClaudeEnvOverride(spec)).toBeUndefined()
  })

  it("unsetEnv only: key is PRESENT with value undefined (not absent)", () => {
    const spec: CliSpec = {
      bin: "claude",
      args: [],
      supportsModelFlag: false,
      unsetEnv: ["ANTHROPIC_API_KEY"],
    }
    const result = buildClaudeEnvOverride(spec)
    expect(result).toBeDefined()
    // Key must be present (in operator) — not absent — so Node's spawn will see it and drop it.
    expect("ANTHROPIC_API_KEY" in result!).toBe(true)
    // Value must be undefined (not the string "undefined").
    expect(result!["ANTHROPIC_API_KEY"]).toBeUndefined()
  })

  it("setEnv only: returns key-value pairs", () => {
    const spec: CliSpec = {
      bin: "claude",
      args: [],
      supportsModelFlag: false,
      setEnv: { NO_PROXY: "api.anthropic.com" },
    }
    const result = buildClaudeEnvOverride(spec)
    expect(result).toBeDefined()
    expect(result!["NO_PROXY"]).toBe("api.anthropic.com")
    // No undefined keys
    expect(Object.values(result!).every((v) => v !== undefined)).toBe(true)
  })

  it("both unsetEnv and setEnv (real use case): ANTHROPIC_API_KEY=undefined + NO_PROXY/no_proxy set", () => {
    const spec: CliSpec = {
      bin: "claude",
      args: [],
      supportsModelFlag: false,
      unsetEnv: ["ANTHROPIC_API_KEY"],
      setEnv: { NO_PROXY: "api.anthropic.com", no_proxy: "api.anthropic.com" },
    }
    const result = buildClaudeEnvOverride(spec)
    expect(result).toBeDefined()
    expect("ANTHROPIC_API_KEY" in result!).toBe(true)
    expect(result!["ANTHROPIC_API_KEY"]).toBeUndefined()
    expect(result!["NO_PROXY"]).toBe("api.anthropic.com")
    expect(result!["no_proxy"]).toBe("api.anthropic.com")
  })

  it("collision: setEnv wins over unsetEnv for same key", () => {
    // If a key appears in both unsetEnv and setEnv, setEnv must win.
    // Order: unsetEnv first (→ undefined), then setEnv overwrites (→ string).
    const spec: CliSpec = {
      bin: "claude",
      args: [],
      supportsModelFlag: false,
      unsetEnv: ["X"],
      setEnv: { X: "v" },
    }
    const result = buildClaudeEnvOverride(spec)
    expect(result).toBeDefined()
    expect(result!["X"]).toBe("v")
  })
})

// ---------------------------------------------------------------------------
// injectEnvOverride
// ---------------------------------------------------------------------------

describe("injectEnvOverride", () => {
  it("returns params unchanged when envOverride is undefined", () => {
    const params = { sessionId: "s1", foo: "bar" }
    const result = injectEnvOverride(params, undefined)
    expect(result).toBe(params) // same reference — no copy needed
  })

  it("sets _meta.claudeCode.options.env on empty params", () => {
    const envOverride = { ANTHROPIC_API_KEY: undefined, NO_PROXY: "api.anthropic.com" }
    const result = injectEnvOverride({}, envOverride)
    const meta = result["_meta"] as Record<string, unknown>
    const claudeCode = meta?.["claudeCode"] as Record<string, unknown>
    const options = claudeCode?.["options"] as Record<string, unknown>
    expect(options?.["env"]).toEqual(envOverride)
  })

  it("does not overwrite existing _meta.claudeCode.options.model", () => {
    // model is set by injectModelOverride; env must be additive.
    const params = {
      _meta: {
        claudeCode: {
          options: {
            model: "claude-opus-4-5",
          },
        },
      },
    }
    const envOverride = { ANTHROPIC_API_KEY: undefined }
    const result = injectEnvOverride(params, envOverride)
    const options = (
      (result["_meta"] as Record<string, unknown>)?.["claudeCode"] as Record<string, unknown>
    )?.["options"] as Record<string, unknown>
    // model preserved
    expect(options?.["model"]).toBe("claude-opus-4-5")
    // env added
    expect(options?.["env"]).toEqual(envOverride)
  })

  it("does not overwrite existing _meta other keys", () => {
    const params = {
      _meta: {
        otherKey: "preserved",
        claudeCode: {
          options: { model: "m" },
        },
      },
    }
    const result = injectEnvOverride(params, { FOO: "bar" })
    const meta = result["_meta"] as Record<string, unknown>
    expect(meta?.["otherKey"]).toBe("preserved")
  })
})
