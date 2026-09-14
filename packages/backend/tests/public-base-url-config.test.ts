/**
 * public-base-url-config.test.ts — PUBLIC_BASE_URL precedence + choke-point validation.
 *
 * Every assertion checks BOTH config and envPatch.
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn().mockReturnValue(""),
}))

import { loadConfig } from "../src/config/load-config.js"

const tmpFiles: string[] = []

function writeTmpJson(obj: unknown): string {
  const p = path.join(
    os.tmpdir(),
    `public-base-url-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
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

describe("publicBaseUrl — env / file / flag precedence", () => {
  it("1. env PUBLIC_BASE_URL → config.publicBaseUrl and envPatch.PUBLIC_BASE_URL", () => {
    const { config, envPatch } = loadConfig({
      argv: { config: "/nonexistent-config.jsonc", ...noopSecrets },
      env: { PUBLIC_BASE_URL: "https://a.example.com" },
    })
    expect(config.publicBaseUrl).toBe("https://a.example.com")
    expect(envPatch.PUBLIC_BASE_URL).toBe("https://a.example.com")
  })

  it("2. file + env → env wins", () => {
    const configPath = writeTmpJson({ publicBaseUrl: "https://file.example.com" })
    const { config, envPatch } = loadConfig({
      argv: { config: configPath, ...noopSecrets },
      env: { PUBLIC_BASE_URL: "https://env.example.com" },
    })
    expect(config.publicBaseUrl).toBe("https://env.example.com")
    expect(envPatch.PUBLIC_BASE_URL).toBe("https://env.example.com")
  })

  it("3. file + env + flag → flag wins", () => {
    const configPath = writeTmpJson({ publicBaseUrl: "https://file.example.com" })
    const { config, envPatch } = loadConfig({
      argv: {
        config: configPath,
        "public-base-url": "https://flag.example.com",
        ...noopSecrets,
      },
      env: { PUBLIC_BASE_URL: "https://env.example.com" },
    })
    expect(config.publicBaseUrl).toBe("https://flag.example.com")
    expect(envPatch.PUBLIC_BASE_URL).toBe("https://flag.example.com")
  })

  it("4. trailing slash input → normalized without slash", () => {
    const { config, envPatch } = loadConfig({
      argv: { config: "/nonexistent-config.jsonc", ...noopSecrets },
      env: { PUBLIC_BASE_URL: "https://a.example.com/" },
    })
    expect(config.publicBaseUrl).toBe("https://a.example.com")
    expect(envPatch.PUBLIC_BASE_URL).toBe("https://a.example.com")
  })

  it("5. file with path → field absent, warning, rest of config survives", () => {
    const configPath = writeTmpJson({
      publicBaseUrl: "https://x.example.com/api",
      port: 4360,
    })
    const { config, envPatch, warnings } = loadConfig({
      argv: { config: configPath, ...noopSecrets },
      env: {},
    })
    expect(config.publicBaseUrl).toBeUndefined()
    expect(envPatch.PUBLIC_BASE_URL).toBeUndefined()
    expect(config.port).toBe(4360)
    expect(warnings.some((w) => w.includes("publicBaseUrl"))).toBe(true)
  })

  it("6. no PUBLIC_BASE_URL at all → no key in envPatch", () => {
    const { config, envPatch } = loadConfig({
      argv: { config: "/nonexistent-config.jsonc", ...noopSecrets },
      env: {},
    })
    expect(config.publicBaseUrl).toBeUndefined()
    expect(envPatch.PUBLIC_BASE_URL).toBeUndefined()
  })
})
