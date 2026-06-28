/**
 * Unit tests for resolveProviderAuth (proxy-auth.ts).
 * Slice: voice-keys-direct, Commit 0 — TDD Red-Green.
 *
 * Covers:
 *   - elevenlabs + key present   → { name: "xi-api-key", value: key }
 *   - google + key present       → { name: "x-goog-api-key", value: key }
 *   - no key in env              → null (passthrough)
 *   - empty string key           → null
 *   - unknown provider           → null
 */

import { describe, expect, it } from "vitest"
import { resolveProviderAuth } from "../src/delivery/proxy-auth.js"

describe("resolveProviderAuth", () => {
  it("elevenlabs + ELEVENLABS_API_KEY set → xi-api-key header", () => {
    const env = { ELEVENLABS_API_KEY: "el-secret-123" }
    const result = resolveProviderAuth("elevenlabs", env)
    expect(result).toEqual({ name: "xi-api-key", value: "el-secret-123" })
  })

  it("google + GEMINI_API_KEY set → x-goog-api-key header", () => {
    const env = { GEMINI_API_KEY: "gm-secret-456" }
    const result = resolveProviderAuth("google", env)
    expect(result).toEqual({ name: "x-goog-api-key", value: "gm-secret-456" })
  })

  it("elevenlabs + no ELEVENLABS_API_KEY → null (passthrough)", () => {
    const env: NodeJS.ProcessEnv = {}
    expect(resolveProviderAuth("elevenlabs", env)).toBeNull()
  })

  it("google + no GEMINI_API_KEY → null (passthrough)", () => {
    const env: NodeJS.ProcessEnv = {}
    expect(resolveProviderAuth("google", env)).toBeNull()
  })

  it("elevenlabs + empty string key → null", () => {
    const env = { ELEVENLABS_API_KEY: "" }
    expect(resolveProviderAuth("elevenlabs", env)).toBeNull()
  })

  it("google + empty string key → null", () => {
    const env = { GEMINI_API_KEY: "" }
    expect(resolveProviderAuth("google", env)).toBeNull()
  })

  it("unknown provider → null (passthrough)", () => {
    const env = { ELEVENLABS_API_KEY: "key", GEMINI_API_KEY: "key2" }
    expect(resolveProviderAuth("openai", env)).toBeNull()
    expect(resolveProviderAuth("unknown", env)).toBeNull()
    expect(resolveProviderAuth("", env)).toBeNull()
  })
})
