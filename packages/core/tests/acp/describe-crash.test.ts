/**
 * Tests for `describeCrash`.
 *
 * Priority order (highest wins):
 *   1. Provider error from stderr (extractProviderError match)
 *   2. Spawn error (spawnError.message)
 *   3. Signal (e.g. SIGKILL)
 *   4. Non-zero exit code
 *   5. undefined — clean exit or no info
 */

import { describe, expect, test } from "vitest"
import { describeCrash } from "../../src/acp/describe-crash.js"
import type { BridgeCrashInfo } from "../../src/acp/describe-crash.js"

const noInfo: BridgeCrashInfo = { exitCode: null, signal: null }

describe("describeCrash — priority 1: provider error from stderr", () => {
  test("credit error in stderr → returns provider message", () => {
    const info: BridgeCrashInfo = { exitCode: null, signal: "SIGKILL" }
    const stderr = [
      `{"message":"Your credit balance is too low to access the Anthropic API."}`,
    ]
    expect(describeCrash(info, stderr)).toBe(
      "Your credit balance is too low to access the Anthropic API.",
    )
  })

  test("provider error wins over signal", () => {
    const info: BridgeCrashInfo = { exitCode: 1, signal: "SIGTERM" }
    const stderr = [`{"message":"Invalid API key provided. Check your authentication."}`]
    expect(describeCrash(info, stderr)).toBe(
      "Invalid API key provided. Check your authentication.",
    )
  })

  test("provider error wins over spawnError", () => {
    const info: BridgeCrashInfo = {
      exitCode: null,
      signal: null,
      spawnError: { code: "ENOENT", message: "spawn npx ENOENT" },
    }
    const stderr = [`{"message":"Rate limit exceeded for this account."}`]
    expect(describeCrash(info, stderr)).toBe("Rate limit exceeded for this account.")
  })
})

describe("describeCrash — priority 2: spawn error", () => {
  test("ENOENT spawn error → includes code and message", () => {
    const info: BridgeCrashInfo = {
      exitCode: null,
      signal: null,
      spawnError: { code: "ENOENT", message: "spawn npx ENOENT" },
    }
    expect(describeCrash(info, [])).toBe("ENOENT: spawn npx ENOENT")
  })

  test("spawn error without code → just message", () => {
    const info: BridgeCrashInfo = {
      exitCode: null,
      signal: null,
      spawnError: { message: "some spawn failure" },
    }
    expect(describeCrash(info, [])).toBe("some spawn failure")
  })

  test("spawn error wins over signal", () => {
    const info: BridgeCrashInfo = {
      exitCode: null,
      signal: "SIGKILL",
      spawnError: { code: "ENOENT", message: "spawn opencode ENOENT" },
    }
    expect(describeCrash(info, [])).toBe("ENOENT: spawn opencode ENOENT")
  })
})

describe("describeCrash — priority 3: signal", () => {
  test("SIGKILL → descriptive message", () => {
    const info: BridgeCrashInfo = { exitCode: null, signal: "SIGKILL" }
    expect(describeCrash(info, [])).toBe("Killed by signal SIGKILL")
  })

  test("SIGTERM → descriptive message", () => {
    const info: BridgeCrashInfo = { exitCode: 0, signal: "SIGTERM" }
    expect(describeCrash(info, [])).toBe("Killed by signal SIGTERM")
  })

  test("signal wins over exit code", () => {
    const info: BridgeCrashInfo = { exitCode: 137, signal: "SIGKILL" }
    expect(describeCrash(info, [])).toBe("Killed by signal SIGKILL")
  })
})

describe("describeCrash — priority 4: non-zero exit code", () => {
  test("exit code 1 → descriptive message", () => {
    const info: BridgeCrashInfo = { exitCode: 1, signal: null }
    expect(describeCrash(info, [])).toBe("Exited with code 1")
  })

  test("exit code 127 (command not found) → descriptive message", () => {
    const info: BridgeCrashInfo = { exitCode: 127, signal: null }
    expect(describeCrash(info, [])).toBe("Exited with code 127")
  })
})

describe("describeCrash — priority 5: undefined (no useful info)", () => {
  test("clean exit (code 0, no signal) → undefined", () => {
    const info: BridgeCrashInfo = { exitCode: 0, signal: null }
    expect(describeCrash(info, [])).toBeUndefined()
  })

  test("no info at all → undefined", () => {
    expect(describeCrash(noInfo, [])).toBeUndefined()
  })

  test("null exit code, null signal, empty stderr → undefined", () => {
    expect(describeCrash({ exitCode: null, signal: null }, [])).toBeUndefined()
  })

  test("stderr with no recognized pattern → falls through to exit code", () => {
    const info: BridgeCrashInfo = { exitCode: 2, signal: null }
    const stderr = ["INFO starting", "INFO something happened"]
    expect(describeCrash(info, stderr)).toBe("Exited with code 2")
  })
})
