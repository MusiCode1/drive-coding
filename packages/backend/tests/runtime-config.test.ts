/**
 * runtime-config.test.ts — re-resolving config.jsonc while the process is live.
 *
 * The test that matters here is "env snapshot beats the feedback loop". Before
 * this module existed there was no test anywhere that called loadConfig twice,
 * which is exactly why the loop went unnoticed: the bin writes envPatch into
 * process.env, and a naive second call rebuilds the env layer from those
 * written-back values, so the env layer beats the freshly edited file and the
 * reload silently does nothing.
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// paths.ts pulls in http-options which calls execFileSync
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn().mockReturnValue(""),
}))

import { loadConfig } from "../src/config/load-config.js"
import {
  captureBootPatch,
  captureConfigInputs,
  HOT_KEYS,
  reloadRuntimeConfig,
  resetConfigInputs,
} from "../src/config/runtime-config.js"

const tmpFiles: string[] = []
/** A path that deliberately does not exist — isolates tests from real secrets. */
const missingSecrets = path.join(os.tmpdir(), "runtime-config-test-no-such-secrets.json")
const touchedEnvKeys = ["ELICITATION_TIMEOUT_MS", "PERMISSION_TIMEOUT_MS", "PORT", "OPENCODE_BIN"]
let origEnv: Record<string, string | undefined> = {}

function writeConfig(obj: unknown): string {
  const p = path.join(
    os.tmpdir(),
    `runtime-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  )
  fs.writeFileSync(p, JSON.stringify(obj))
  if (!tmpFiles.includes(p)) tmpFiles.push(p)
  return p
}

/**
 * Replays what bin/drive-coding.ts does at boot: capture, then write the patch.
 *
 * `secrets` is always pointed at a test-owned path. Without it loadConfig falls
 * back to the real <stateDir>/secrets.json, and the machine's actual API keys
 * leak into the assertions — which is exactly how this helper failed the first
 * time it ran here.
 */
function boot(configPath: string, env: NodeJS.ProcessEnv = {}, secretsPath = missingSecrets): void {
  const argv = { config: configPath, secrets: secretsPath }
  captureConfigInputs(argv, env)
  const { envPatch } = loadConfig({ argv, env })
  captureBootPatch(envPatch)
  for (const [k, v] of Object.entries(envPatch)) process.env[k] = v
}

beforeEach(() => {
  origEnv = {}
  for (const k of touchedEnvKeys) origEnv[k] = process.env[k]
})

afterEach(() => {
  resetConfigInputs()
  for (const k of touchedEnvKeys) {
    if (origEnv[k] === undefined) delete process.env[k]
    else process.env[k] = origEnv[k]
  }
  for (const f of tmpFiles) {
    try {
      fs.unlinkSync(f)
    } catch {
      /* ignore */
    }
  }
  tmpFiles.length = 0
})

describe("reloadRuntimeConfig", () => {
  it("🔴 picks up an edited config file after the boot envPatch was written", () => {
    const configPath = writeConfig({ elicitationTimeoutMs: 5000 })
    boot(configPath)
    expect(process.env.ELICITATION_TIMEOUT_MS).toBe("5000")

    // The user edits the file while the process runs.
    fs.writeFileSync(configPath, JSON.stringify({ elicitationTimeoutMs: 9000 }))

    const outcome = reloadRuntimeConfig()

    expect(outcome.applied).toContain("ELICITATION_TIMEOUT_MS")
    expect(process.env.ELICITATION_TIMEOUT_MS).toBe("9000")
  })

  it("documents the feedback loop the snapshot exists to break", () => {
    const configPath = writeConfig({ elicitationTimeoutMs: 5000 })
    boot(configPath)
    fs.writeFileSync(configPath, JSON.stringify({ elicitationTimeoutMs: 9000 }))

    // The naive reload: feed process.env back in. The env layer is rebuilt from
    // the value the boot wrote, and since precedence is file < env, it wins —
    // the edited file is ignored. This is the bug, pinned so it stays fixed.
    const naive = loadConfig({
      argv: { config: configPath, secrets: missingSecrets },
      env: process.env,
    })
    expect(naive.envPatch.ELICITATION_TIMEOUT_MS).toBe("5000")

    // The real reload replays the original env instead, so the file wins.
    const outcome = reloadRuntimeConfig()
    expect(outcome.applied).toContain("ELICITATION_TIMEOUT_MS")
    expect(process.env.ELICITATION_TIMEOUT_MS).toBe("9000")
  })

  it("a real env var still beats the config file across a reload", () => {
    const configPath = writeConfig({ elicitationTimeoutMs: 5000 })
    // ELICITATION_TIMEOUT_MS genuinely present in the environment, not derived.
    boot(configPath, { ELICITATION_TIMEOUT_MS: "1234" })
    expect(process.env.ELICITATION_TIMEOUT_MS).toBe("1234")

    fs.writeFileSync(configPath, JSON.stringify({ elicitationTimeoutMs: 9000 }))
    reloadRuntimeConfig()

    // Precedence is preserved: env > file, before and after the reload.
    expect(process.env.ELICITATION_TIMEOUT_MS).toBe("1234")
  })

  it("reports cold keys as requiring a restart instead of applying them", () => {
    const configPath = writeConfig({ port: 4100 })
    boot(configPath)
    expect(process.env.PORT).toBe("4100")

    fs.writeFileSync(configPath, JSON.stringify({ port: 4200 }))
    const outcome = reloadRuntimeConfig()

    expect(outcome.requiresRestart).toContain("PORT")
    expect(outcome.applied).not.toContain("PORT")
    // Unchanged: the listening socket is already bound to the old one, and
    // pretending otherwise is the silent failure this guards against.
    expect(process.env.PORT).toBe("4100")
  })

  it("an unchanged file yields an empty outcome", () => {
    const configPath = writeConfig({ elicitationTimeoutMs: 5000 })
    boot(configPath)

    const outcome = reloadRuntimeConfig()

    expect(outcome.applied).toEqual([])
    expect(outcome.requiresRestart).toEqual([])
  })

  it("applies a rotated API key — the case the whole slice exists for", () => {
    const configPath = writeConfig({})
    // Secrets live in their own file here; a key in the plain config file is a
    // fatal violation at boot.
    const secretsPath = writeConfig({ elevenLabsKey: "key-old" })
    boot(configPath, {}, secretsPath)
    expect(process.env.ELEVENLABS_API_KEY).toBe("key-old")

    fs.writeFileSync(secretsPath, JSON.stringify({ elevenLabsKey: "key-new" }))
    const outcome = reloadRuntimeConfig()

    expect(outcome.applied).toContain("ELEVENLABS_API_KEY")
    // resolveProviderAuth reads process.env per request, so the next proxied
    // call already carries the new key — no restart, no code change.
    expect(process.env.ELEVENLABS_API_KEY).toBe("key-new")
  })

  // 🔴 Regression: found by code review, then reproduced live against a running
  // preview — deleting the key from secrets.json left it serving requests.
  it("deleting a key from the file stops it from being used", () => {
    const configPath = writeConfig({})
    const secretsPath = writeConfig({ elevenLabsKey: "key-old" })
    boot(configPath, {}, secretsPath)
    expect(process.env.ELEVENLABS_API_KEY).toBe("key-old")

    // The user removes the key — revoking it, not changing it.
    fs.writeFileSync(secretsPath, JSON.stringify({}))
    const outcome = reloadRuntimeConfig()

    expect(outcome.applied).toContain("ELEVENLABS_API_KEY")
    expect(process.env.ELEVENLABS_API_KEY).toBeUndefined()
  })

  it("a deleted key falls back to the environment, not to unset", () => {
    const configPath = writeConfig({ elicitationTimeoutMs: 9000 })
    // The file overrides a value that also genuinely exists in the environment.
    boot(configPath, { ELICITATION_TIMEOUT_MS: "1234" })

    fs.writeFileSync(configPath, JSON.stringify({}))
    reloadRuntimeConfig()

    // Precedence returns to where it was at boot — env still provides it.
    expect(process.env.ELICITATION_TIMEOUT_MS).toBe("1234")
  })

  it("removing a cold key reports a restart rather than clearing it", () => {
    const configPath = writeConfig({ port: 4100 })
    boot(configPath)
    expect(process.env.PORT).toBe("4100")

    fs.writeFileSync(configPath, JSON.stringify({}))
    const outcome = reloadRuntimeConfig()

    expect(outcome.requiresRestart).toContain("PORT")
    expect(process.env.PORT).toBe("4100")
  })

  it("without a snapshot it declines rather than guessing", () => {
    resetConfigInputs()
    const outcome = reloadRuntimeConfig()
    expect(outcome.applied).toEqual([])
    expect(outcome.warnings.join(" ")).toMatch(/no snapshot/i)
  })
})

describe("HOT_KEYS", () => {
  // Guards the boundary itself: these are baked into the HTTP server at boot
  // (bound socket, registered middleware, closure consts). Adding one here
  // would make a reload look successful while changing nothing.
  const coldKeys = [
    "PORT",
    "DRIVE_CODING_HOST",
    "DRIVE_CODING_HTTPS",
    "CORS_ORIGINS",
    "FE_STATIC_DIR",
    "RSS_BUDGET_MB",
    "HOTPATH_SLOW_MS",
    "HTTP_OWNER_TTL_MS",
    "WIRE_RECORD",
    "FS_BROWSE_ALLOWED_BASE",
    // No CONFIG_SPECS entry ⇒ never in an envPatch ⇒ listing them would be
    // dead code that reads as a promise.
    "OPENCODE_ARGS",
    "LOG_WIRE",
  ]

  for (const key of coldKeys) {
    it(`${key} is not hot-reloadable`, () => {
      expect(HOT_KEYS.has(key)).toBe(false)
    })
  }

  it("covers the keys verified to be re-read per use", () => {
    for (const key of [
      "ELEVENLABS_API_KEY",
      "GEMINI_API_KEY",
      "OPENCODE_BIN",
      "ELICITATION_TIMEOUT_MS",
      "PERMISSION_TIMEOUT_MS",
    ]) {
      expect(HOT_KEYS.has(key)).toBe(true)
    }
  })
})
