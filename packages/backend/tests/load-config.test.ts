/**
 * load-config.test.ts — integration tests for loadConfig.
 *
 * Covers:
 *  1. port from file layer
 *  2. port from env layer overrides file
 *  3. port from flag layer overrides env + file (full precedence)
 *  4. --config-json inline overrides file
 *  5. broken --config-json → warning, no crash
 *  6. env-layer voice keys
 *  7. flag-layer --elevenlabs-key → warning about process list visibility
 *  8. cliSpecs from file → CLI_SPECS_JSON in envPatch
 *  9. --log-level flag → LOG_LEVEL in envPatch
 * 10. all defaults absent → empty config + empty envPatch (no crash)
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

// Mock child_process (paths.ts pulls in http-options which calls execFileSync)
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn().mockReturnValue(""),
}))

// We always import fresh (no memoization issue here, but be safe)
import { loadConfig } from "../src/config/load-config.js"

const tmpFiles: string[] = []

function writeTmpJson(obj: unknown, ext = ".json"): string {
  const p = path.join(os.tmpdir(), `load-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`)
  fs.writeFileSync(p, typeof obj === "string" ? obj : JSON.stringify(obj))
  tmpFiles.push(p)
  return p
}

afterEach(() => {
  for (const f of tmpFiles) {
    try { fs.unlinkSync(f) } catch { /* ignore */ }
  }
  tmpFiles.length = 0
})

describe("loadConfig — precedence", () => {
  it("1. port from file layer", () => {
    const configPath = writeTmpJson({ port: 4100 })
    const { config, envPatch, warnings } = loadConfig({
      argv: { config: configPath },
      env: {},
    })
    expect(warnings.filter(w => w.includes("validation") || w.includes("invalid"))).toHaveLength(0)
    expect(config.port).toBe(4100)
    expect(envPatch["PORT"]).toBe("4100")
  })

  it("2. env layer overrides file", () => {
    const configPath = writeTmpJson({ port: 4100 })
    const { config, envPatch } = loadConfig({
      argv: { config: configPath },
      env: { PORT: "4200" },
    })
    expect(config.port).toBe(4200)
    expect(envPatch["PORT"]).toBe("4200")
  })

  it("3. flag layer wins over env + file", () => {
    const configPath = writeTmpJson({ port: 4100 })
    const { config, envPatch } = loadConfig({
      argv: { config: configPath, port: "4300" },
      env: { PORT: "4200" },
    })
    expect(config.port).toBe(4300)
    expect(envPatch["PORT"]).toBe("4300")
  })

  it("4. --config-json inline overrides file (file is ignored)", () => {
    const configPath = writeTmpJson({ port: 4100 })
    const { config } = loadConfig({
      argv: {
        config: configPath,
        "config-json": JSON.stringify({ port: 4500, feStaticDir: "/from-inline" }),
      },
      env: {},
    })
    // --config-json replaces file layer entirely
    expect(config.port).toBe(4500)
    expect(config.feStaticDir).toBe("/from-inline")
  })

  it("5. broken --config-json → warning, port falls back", () => {
    const { config, warnings } = loadConfig({
      argv: { "config-json": "{ this is not json }" },
      env: { PORT: "4200" },
    })
    expect(warnings.some(w => w.includes("invalid JSON"))).toBe(true)
    // env layer still applies
    expect(config.port).toBe(4200)
  })
})

describe("loadConfig — env vars", () => {
  it("6. voice keys from env", () => {
    const { config, envPatch } = loadConfig({
      argv: {},
      env: { ELEVENLABS_API_KEY: "el-key", GEMINI_API_KEY: "gm-key" },
    })
    expect(config.voice?.elevenLabsKey).toBe("el-key")
    expect(config.voice?.geminiKey).toBe("gm-key")
    expect(envPatch["ELEVENLABS_API_KEY"]).toBe("el-key")
    expect(envPatch["GEMINI_API_KEY"]).toBe("gm-key")
  })

  it("CORS_ORIGINS from env → array in config + joined back in envPatch", () => {
    const { config, envPatch } = loadConfig({
      argv: {},
      env: { CORS_ORIGINS: "http://a.com,http://b.com" },
    })
    expect(config.corsOrigins).toEqual(["http://a.com", "http://b.com"])
    expect(envPatch["CORS_ORIGINS"]).toBe("http://a.com,http://b.com")
  })
})

describe("loadConfig — flag secrets", () => {
  it("7. --elevenlabs-key flag → warning about process list visibility", () => {
    const { config, warnings } = loadConfig({
      argv: { "elevenlabs-key": "secret-key" },
      env: {},
    })
    expect(warnings.some(w => w.includes("visible in the process list"))).toBe(true)
    expect(config.voice?.elevenLabsKey).toBe("secret-key")
  })

  it("--gemini-key flag → warning", () => {
    const { warnings } = loadConfig({
      argv: { "gemini-key": "secret" },
      env: {},
    })
    expect(warnings.some(w => w.includes("gemini-key") && w.includes("visible"))).toBe(true)
  })
})

describe("loadConfig — cliSpecs", () => {
  it("8. cliSpecs from file → CLI_SPECS_JSON in envPatch", () => {
    const configPath = writeTmpJson({ cliSpecs: { opencode: { bin: "/custom/opencode" } } })
    const { config, envPatch } = loadConfig({ argv: { config: configPath }, env: {} })
    expect(config.cliSpecs?.["opencode"]).toEqual({ bin: "/custom/opencode" })
    expect(envPatch["CLI_SPECS_JSON"]).toBeDefined()
    const parsed = JSON.parse(envPatch["CLI_SPECS_JSON"]!) as Record<string, unknown>
    expect((parsed["opencode"] as { bin: string }).bin).toBe("/custom/opencode")
  })
})

describe("loadConfig — log flags", () => {
  it("9. --log-level flag → LOG_LEVEL in envPatch", () => {
    const { envPatch } = loadConfig({ argv: { "log-level": "debug" }, env: {} })
    expect(envPatch["LOG_LEVEL"]).toBe("debug")
  })
})

describe("loadConfig — empty inputs", () => {
  it("10. all absent → no crash, empty envPatch", () => {
    const { config, envPatch, warnings } = loadConfig({ argv: {}, env: {} })
    expect(config).toEqual({})
    expect(envPatch).toEqual({})
    expect(warnings).toHaveLength(0)
  })
})
