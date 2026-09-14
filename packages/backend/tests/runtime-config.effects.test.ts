/**
 * runtime-config.effects.test.ts — cache invalidation after a reload.
 *
 * Separate file because these tests mock the modules that own the caches, and
 * that mocking must not leak into runtime-config.test.ts, which exercises the
 * real resolution path.
 *
 * What is being guarded: applying a value is only half the job. If the caches
 * that shadow it are not dropped, the reload looks broken from the outside —
 * the TTS probe in particular keeps reporting `auth` failure for up to a minute
 * after the key was already fixed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn().mockReturnValue(""),
}))

// vi.mock factories are hoisted above module-level consts, so the spies have to
// be created inside vi.hoisted or they are not initialised when the factory runs.
const { invalidateCapabilitiesCache, initLogger, parseEnvConfig } = vi.hoisted(() => ({
  invalidateCapabilitiesCache: vi.fn(),
  initLogger: vi.fn(),
  parseEnvConfig: vi.fn().mockReturnValue({ level: "info" }),
}))

vi.mock("../src/delivery/http-tts-capabilities.js", () => ({
  invalidateCapabilitiesCache,
}))

vi.mock("@drive-coding/core/log", () => ({
  initLogger,
  parseEnvConfig,
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { applyReloadEffects } from "../src/config/runtime-config.js"

beforeEach(() => {
  invalidateCapabilitiesCache.mockClear()
  initLogger.mockClear()
})

afterEach(() => {
  vi.clearAllMocks()
})

const empty = { applied: [] as string[], requiresRestart: [] as string[], warnings: [] as string[] }

describe("applyReloadEffects", () => {
  it("drops the TTS probe cache when an ElevenLabs key was applied", () => {
    applyReloadEffects({ ...empty, applied: ["ELEVENLABS_API_KEY"] })
    expect(invalidateCapabilitiesCache).toHaveBeenCalledOnce()
  })

  it("drops it for a Gemini key too", () => {
    applyReloadEffects({ ...empty, applied: ["GEMINI_API_KEY"] })
    expect(invalidateCapabilitiesCache).toHaveBeenCalledOnce()
  })

  it("leaves the probe cache alone when no key moved", () => {
    applyReloadEffects({ ...empty, applied: ["ELICITATION_TIMEOUT_MS"] })
    expect(invalidateCapabilitiesCache).not.toHaveBeenCalled()
  })

  it("re-initialises the logger when a LOG_* key was applied", () => {
    applyReloadEffects({ ...empty, applied: ["LOG_LEVEL"] })
    expect(initLogger).toHaveBeenCalledOnce()
  })

  it("does nothing at all for an empty outcome", () => {
    applyReloadEffects(empty)
    expect(invalidateCapabilitiesCache).not.toHaveBeenCalled()
    expect(initLogger).not.toHaveBeenCalled()
  })

  it("ignores keys that only require a restart", () => {
    // requiresRestart must never trigger side effects — the value was NOT applied.
    applyReloadEffects({ ...empty, requiresRestart: ["ELEVENLABS_API_KEY", "LOG_LEVEL"] })
    expect(invalidateCapabilitiesCache).not.toHaveBeenCalled()
    expect(initLogger).not.toHaveBeenCalled()
  })
})
