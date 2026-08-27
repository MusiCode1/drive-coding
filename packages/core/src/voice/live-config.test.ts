/**
 * live-config.test.ts — TDD for slice live-config-control, Commit 0.
 */

import { describe, expect, it } from "vitest"
import {
  APP_SETTING_KEYS,
  formatConfigSeedLine,
  formatListConfigSnapshot,
  validateAppSetting,
  type ConfigSnapshot,
  type ListConfigInput,
} from "./live-config"

function baseInput(overrides?: Partial<ListConfigInput>): ListConfigInput {
  return {
    session: {
      connected: true,
      options: [],
      ...overrides?.session,
    },
    app: {
      screenWakeLock: false,
      locale: "he",
      theme: "ember",
      themeChoices: ["ember", "forest", "daylight"],
      ...overrides?.app,
    },
  }
}

describe("APP_SETTING_KEYS", () => {
  it("contains exactly screenWakeLock, locale, theme", () => {
    expect([...APP_SETTING_KEYS]).toEqual(["screenWakeLock", "locale", "theme"])
  })
})

describe("validateAppSetting()", () => {
  it("accepts screenWakeLock true/false strings", () => {
    expect(validateAppSetting("screenWakeLock", "true")).toEqual({ ok: true })
    expect(validateAppSetting("screenWakeLock", "false")).toEqual({ ok: true })
  })

  it("accepts locale he/en", () => {
    expect(validateAppSetting("locale", "he")).toEqual({ ok: true })
    expect(validateAppSetting("locale", "en")).toEqual({ ok: true })
  })

  it("accepts theme when in themeChoices", () => {
    const choices = ["ember", "daylight"] as const
    expect(validateAppSetting("theme", "daylight", { themeChoices: choices })).toEqual({
      ok: true,
    })
  })

  it("rejects unknown-key", () => {
    expect(validateAppSetting("carMode", "true")).toEqual({ ok: false, reason: "unknown-key" })
    expect(validateAppSetting("muted", "false")).toEqual({ ok: false, reason: "unknown-key" })
  })

  it("rejects invalid-value for locale", () => {
    expect(validateAppSetting("locale", "fr")).toEqual({ ok: false, reason: "invalid-value" })
  })

  it("rejects invalid-value for theme not in choices", () => {
    expect(validateAppSetting("theme", "neon", { themeChoices: ["ember"] })).toEqual({
      ok: false,
      reason: "invalid-value",
    })
  })

  it("rejects invalid-value for screenWakeLock", () => {
    expect(validateAppSetting("screenWakeLock", "yes")).toEqual({
      ok: false,
      reason: "invalid-value",
    })
  })
})

describe("formatListConfigSnapshot()", () => {
  it("reflects connected=false when session disconnected", () => {
    const snap = formatListConfigSnapshot(baseInput({ session: { connected: false, options: [] } }))
    expect(snap.session.connected).toBe(false)
  })

  it("includes model with choices from modelId-mapped ids", () => {
    const snap = formatListConfigSnapshot(
      baseInput({
        session: {
          connected: true,
          options: [],
          model: {
            id: "anthropic/claude-sonnet",
            name: "Sonnet",
            choices: [
              { id: "anthropic/claude-sonnet", name: "Sonnet" },
              { id: "anthropic/claude-opus", name: "Opus" },
            ],
          },
        },
      }),
    )
    expect(snap.session.model).toEqual({
      id: "anthropic/claude-sonnet",
      name: "Sonnet",
      choices: [
        { id: "anthropic/claude-sonnet", name: "Sonnet" },
        { id: "anthropic/claude-opus", name: "Opus" },
      ],
    })
  })

  it("includes select and boolean options with flattened choices", () => {
    const snap = formatListConfigSnapshot(
      baseInput({
        session: {
          connected: true,
          options: [
            {
              id: "effort",
              name: "Effort",
              type: "select",
              current: "high",
              choices: [
                { id: "low", name: "Low" },
                {
                  options: [
                    { id: "medium", name: "Medium" },
                    { id: "high", name: "High" },
                  ],
                },
              ],
            },
            {
              id: "verbose",
              name: "Verbose",
              type: "boolean",
              current: true,
            },
          ],
        },
      }),
    )
    expect(snap.session.options).toHaveLength(2)
    const effort = snap.session.options[0]
    expect(effort).toMatchObject({
      id: "effort",
      type: "select",
      current: "high",
    })
    expect(effort?.choices).toEqual([
      { id: "low", name: "Low" },
      { id: "medium", name: "Medium" },
      { id: "high", name: "High" },
    ])
    expect(snap.session.options[1]).toMatchObject({
      id: "verbose",
      type: "boolean",
      current: true,
    })
  })

  it("includes thinking with level off when available but no level provided", () => {
    const snap = formatListConfigSnapshot(
      baseInput({
        session: {
          connected: true,
          options: [],
          thinkingAvailable: true,
        },
      }),
    )
    expect(snap.session.thinking).toEqual({ level: "off", available: true })
  })

  it("includes thinking level when provided", () => {
    const snap = formatListConfigSnapshot(
      baseInput({
        session: {
          connected: true,
          options: [],
          thinkingAvailable: true,
          thinkingLevel: "medium",
        },
      }),
    )
    expect(snap.session.thinking).toEqual({ level: "medium", available: true })
  })

  it("omits thinking when not available", () => {
    const snap = formatListConfigSnapshot(
      baseInput({
        session: {
          connected: true,
          options: [],
          thinkingAvailable: false,
        },
      }),
    )
    expect(snap.session.thinking).toBeUndefined()
  })

  it("passes through app settings and themeChoices", () => {
    const snap = formatListConfigSnapshot(
      baseInput({
        app: {
          screenWakeLock: true,
          locale: "en",
          theme: "daylight",
          themeChoices: ["ember", "daylight"],
        },
      }),
    )
    expect(snap.app).toEqual({
      screenWakeLock: true,
      locale: "en",
      theme: "daylight",
      themeChoices: ["ember", "daylight"],
    })
  })
})

describe("formatConfigSeedLine()", () => {
  it("uses English keys only — no Hebrew", () => {
    const snap: ConfigSnapshot = formatListConfigSnapshot(
      baseInput({
        session: {
          connected: true,
          options: [],
          model: { id: "claude-sonnet", choices: [] },
          mode: { id: "plan", choices: [] },
          thinkingAvailable: true,
        },
        app: {
          screenWakeLock: true,
          locale: "he",
          theme: "daylight",
          themeChoices: ["daylight"],
        },
      }),
    )
    const line = formatConfigSeedLine(snap)
    expect(line).toMatch(/model=claude-sonnet/)
    expect(line).toMatch(/mode=plan/)
    expect(line).toMatch(/screenWakeLock=true/)
    expect(line).toMatch(/locale=he/)
    expect(line).toMatch(/theme=daylight/)
    expect(line).toMatch(/thinking=off/)
    expect(line).not.toMatch(/[\u0590-\u05FF]/)
  })

  it("skips absent optional session fields", () => {
    const snap = formatListConfigSnapshot(
      baseInput({ session: { connected: true, options: [] } }),
    )
    const line = formatConfigSeedLine(snap)
    expect(line).not.toContain("model=")
    expect(line).not.toContain("mode=")
    expect(line).not.toContain("thinking=")
    expect(line).toContain("screenWakeLock=")
  })
})
