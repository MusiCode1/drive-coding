/**
 * config-mapping.test.ts — mapping invariants + bugs/55 closure gates.
 *
 * Every assertion checks BOTH config and envPatch (the direction that failed silently).
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn().mockReturnValue(""),
}))

import { resolveConfig } from "@drive-coding/core/config/resolve"
import { loadConfig } from "../src/config/load-config.js"

const tmpFiles: string[] = []

function writeTmpJson(obj: unknown): string {
  const p = path.join(
    os.tmpdir(),
    `config-mapping-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  )
  fs.writeFileSync(p, JSON.stringify(obj))
  tmpFiles.push(p)
  return p
}

afterEach(() => {
  for (const f of tmpFiles) {
    try {
      fs.unlinkSync(f)
    } catch {
      /* ignore */
    }
  }
  tmpFiles.length = 0
})

const noopSecrets = { secrets: "/nonexistent-secrets.json" }

describe("bugs/55 — log partial layer must not erase siblings", () => {
  it("1. file {log.ns,log.format} + flag --log-level → all three in config and envPatch", () => {
    const configPath = writeTmpJson({ log: { ns: "backend.*", format: "json" } })
    const { config, envPatch } = loadConfig({
      argv: { "log-level": "debug", config: configPath, ...noopSecrets },
      env: {},
    })
    expect(config.log?.level).toBe("debug")
    expect(config.log?.ns).toBe("backend.*")
    expect(config.log?.format).toBe("json")
    expect(envPatch["LOG_LEVEL"]).toBe("debug")
    expect(envPatch["LOG_NS"]).toBe("backend.*")
    expect(envPatch["LOG_FORMAT"]).toBe("json")
  })

  it("2. env LOG_NS+LOG_FORMAT + flag --log-level → all three in envPatch", () => {
    const { config, envPatch } = loadConfig({
      argv: { "log-level": "debug", config: "/nonexistent-config.jsonc", ...noopSecrets },
      env: { LOG_NS: "backend.*", LOG_FORMAT: "json" },
    })
    expect(config.log?.level).toBe("debug")
    expect(config.log?.ns).toBe("backend.*")
    expect(config.log?.format).toBe("json")
    expect(envPatch["LOG_LEVEL"]).toBe("debug")
    expect(envPatch["LOG_NS"]).toBe("backend.*")
    expect(envPatch["LOG_FORMAT"]).toBe("json")
  })

  it("3. file {log.ns,log.format} + env LOG_LEVEL → all three in envPatch", () => {
    const configPath = writeTmpJson({ log: { ns: "backend.*", format: "json" } })
    const { config, envPatch } = loadConfig({
      argv: { config: configPath, ...noopSecrets },
      env: { LOG_LEVEL: "debug" },
    })
    expect(config.log?.level).toBe("debug")
    expect(config.log?.ns).toBe("backend.*")
    expect(config.log?.format).toBe("json")
    expect(envPatch["LOG_LEVEL"]).toBe("debug")
    expect(envPatch["LOG_NS"]).toBe("backend.*")
    expect(envPatch["LOG_FORMAT"]).toBe("json")
  })
})

describe("CONFIG_SPECS mapping invariants", () => {
  it('4. CORS_ORIGINS="" → field absent entirely (not [])', () => {
    const { config, envPatch } = loadConfig({
      argv: { config: "/nonexistent-config.jsonc", ...noopSecrets },
      env: { CORS_ORIGINS: "" },
    })
    expect(config.corsOrigins).toBeUndefined()
    expect(envPatch["CORS_ORIGINS"]).toBeUndefined()
  })

  it('5. CORS_ORIGINS=" , " → [] and envPatch.CORS_ORIGINS === ""', () => {
    const { config, envPatch } = loadConfig({
      argv: { config: "/nonexistent-config.jsonc", ...noopSecrets },
      env: { CORS_ORIGINS: " , " },
    })
    expect(config.corsOrigins).toEqual([])
    expect(envPatch["CORS_ORIGINS"]).toBe("")
  })

  it('6. --cors-origins "" does not override non-empty env', () => {
    const { config, envPatch } = loadConfig({
      argv: { "cors-origins": "", config: "/nonexistent-config.jsonc", ...noopSecrets },
      env: { CORS_ORIGINS: "a,b" },
    })
    expect(config.corsOrigins).toEqual(["a", "b"])
    expect(envPatch["CORS_ORIGINS"]).toBe("a,b")
  })

  it("7. WIRE_RECORD truthiness mapping", () => {
    const cases = [
      { env: "1", config: true, patch: "1" },
      { env: "0", config: false, patch: "0" },
      { env: "true", config: false, patch: "0" },
      { env: "", config: undefined, patch: undefined },
    ] as const
    for (const c of cases) {
      const { config, envPatch } = loadConfig({
        argv: { config: "/nonexistent-config.jsonc", ...noopSecrets },
        env: { WIRE_RECORD: c.env },
      })
      expect(config.wireRecord).toBe(c.config)
      expect(envPatch["WIRE_RECORD"]).toBe(c.patch)
    }
  })

  it('8. PORT="abc" and PORT="" → layer skipped, product default applied', () => {
    for (const portEnv of ["abc", ""]) {
      const { config, envPatch } = loadConfig({
        argv: { config: "/nonexistent-config.jsonc", ...noopSecrets },
        env: { PORT: portEnv },
      })
      expect(config.port).toBe(4000)
      expect(envPatch["PORT"]).toBe("4000")
    }
  })

  it('9. LOG_FORMAT="bogus" → log.format absent', () => {
    const { config, envPatch } = loadConfig({
      argv: { config: "/nonexistent-config.jsonc", ...noopSecrets },
      env: { LOG_FORMAT: "bogus" },
    })
    expect(config.log?.format).toBeUndefined()
    expect(envPatch["LOG_FORMAT"]).toBeUndefined()
  })

  it("10. cliSpecs and https keep boundary behavior", () => {
    const cliResult = resolveConfig([
      { cliSpecs: { opencode: { bin: "/file/opencode" }, gemini: { bin: "/file/gemini" } } },
      { cliSpecs: { opencode: { bin: "/env/opencode" } } },
    ])
    expect(cliResult.isOk()).toBe(true)
    const cliCfg = cliResult._unsafeUnwrap()
    expect((cliCfg.cliSpecs?.["opencode"] as { bin: string }).bin).toBe("/env/opencode")
    expect((cliCfg.cliSpecs?.["gemini"] as { bin: string }).bin).toBe("/file/gemini")

    const httpsResult = resolveConfig([
      { https: true },
      { https: { key: "/path/key.pem", cert: "/path/cert.pem" } },
    ])
    expect(httpsResult.isOk()).toBe(true)
    expect(httpsResult._unsafeUnwrap().https).toEqual({
      key: "/path/key.pem",
      cert: "/path/cert.pem",
    })
  })
})
