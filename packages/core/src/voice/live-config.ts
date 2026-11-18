/**
 * live-config.ts — config snapshot + app-setting validation (pure, no IO).
 *
 * Slice: live-config-control, Commit 0.
 *
 * `formatListConfigSnapshot` expects a flat DTO from the Live VM. Select `choices`
 * may be flat `{ id, name }[]` or grouped `{ options: { id, name }[] }[]` — groups
 * are flattened here (same rule as SessionOptionsPanel.flattenSelectOptions).
 */

export const APP_SETTING_KEYS = ["screenWakeLock", "locale", "theme"] as const
export type AppSettingKey = (typeof APP_SETTING_KEYS)[number]

const VALID_LOCALES = ["he", "en"] as const
type Locale = (typeof VALID_LOCALES)[number]

export type ThinkingLevel = "off" | "low" | "medium" | "high"

export type ConfigChoice = { id: string; name: string }

/** Grouped or flat select choice — VM may send either; core flattens. */
export type SelectChoiceInput =
  | ConfigChoice
  | { options: readonly ConfigChoice[] }

export type ListConfigOptionInput = {
  id: string
  name: string
  type: "select" | "boolean"
  current: string | boolean | null
  choices?: readonly SelectChoiceInput[]
}

export type ListConfigInput = {
  session: {
    connected: boolean
    model?: {
      id?: string
      name?: string
      choices: readonly ConfigChoice[]
    }
    mode?: {
      id?: string
      name?: string
      choices: readonly ConfigChoice[]
    }
    options: readonly ListConfigOptionInput[]
    thinkingAvailable?: boolean
    thinkingLevel?: ThinkingLevel
  }
  app: {
    screenWakeLock: boolean
    locale: Locale
    theme: string
    themeChoices: readonly string[]
  }
}

export type ConfigSnapshot = {
  session: {
    connected: boolean
    model?: { id: string; name?: string; choices: ConfigChoice[] }
    mode?: { id: string; name?: string; choices: ConfigChoice[] }
    options: {
      id: string
      name: string
      type: "select" | "boolean"
      current: string | boolean | null
      choices?: ConfigChoice[]
    }[]
    thinking?: { level: ThinkingLevel; available: true }
  }
  app: {
    screenWakeLock: boolean
    locale: Locale
    theme: string
    themeChoices: readonly string[]
  }
}

export type AppSettingValidation =
  | { ok: true }
  | { ok: false; reason: "unknown-key" | "invalid-value" }

function isAppSettingKey(key: string): key is AppSettingKey {
  return (APP_SETTING_KEYS as readonly string[]).includes(key)
}

function flattenChoices(items: readonly SelectChoiceInput[]): ConfigChoice[] {
  return items.flatMap((item) => ("options" in item ? [...item.options] : [item]))
}

export function validateAppSetting(
  key: string,
  value: string,
  opts?: { themeChoices?: readonly string[] },
): AppSettingValidation {
  if (!isAppSettingKey(key)) {
    return { ok: false, reason: "unknown-key" }
  }

  switch (key) {
    case "screenWakeLock":
      if (value !== "true" && value !== "false") {
        return { ok: false, reason: "invalid-value" }
      }
      return { ok: true }
    case "locale":
      if (!(VALID_LOCALES as readonly string[]).includes(value)) {
        return { ok: false, reason: "invalid-value" }
      }
      return { ok: true }
    case "theme": {
      const choices = opts?.themeChoices ?? []
      if (!choices.includes(value)) {
        return { ok: false, reason: "invalid-value" }
      }
      return { ok: true }
    }
  }
}

function normalizeOption(opt: ListConfigOptionInput): ConfigSnapshot["session"]["options"][number] {
  const base = {
    id: opt.id,
    name: opt.name,
    type: opt.type,
    current: opt.current,
  }
  if (opt.type === "select" && opt.choices !== undefined) {
    return { ...base, choices: flattenChoices(opt.choices) }
  }
  return base
}

export function formatListConfigSnapshot(input: ListConfigInput): ConfigSnapshot {
  const { session, app } = input

  const snapshot: ConfigSnapshot = {
    session: {
      connected: session.connected,
      options: session.options.map(normalizeOption),
    },
    app: { ...app },
  }

  if (session.model !== undefined) {
    snapshot.session.model = {
      id: session.model.id ?? "",
      name: session.model.name,
      choices: [...session.model.choices],
    }
  }

  if (session.mode !== undefined) {
    snapshot.session.mode = {
      id: session.mode.id ?? "",
      name: session.mode.name,
      choices: [...session.mode.choices],
    }
  }

  if (session.thinkingAvailable) {
    snapshot.session.thinking = {
      level: session.thinkingLevel ?? "off",
      available: true,
    }
  }

  return snapshot
}

/** English key=value seed line for silent context injection (no Hebrew here). */
export function formatConfigSeedLine(snapshot: ConfigSnapshot): string {
  const parts: string[] = []

  if (snapshot.session.model?.id) {
    parts.push(`model=${snapshot.session.model.id}`)
  }
  if (snapshot.session.mode?.id) {
    parts.push(`mode=${snapshot.session.mode.id}`)
  }
  for (const opt of snapshot.session.options) {
    if (opt.current === null) continue
    const v = typeof opt.current === "boolean" ? String(opt.current) : opt.current
    parts.push(`${opt.id}=${v}`)
  }
  if (snapshot.session.thinking !== undefined) {
    parts.push(`thinking=${snapshot.session.thinking.level}`)
  }

  parts.push(`screenWakeLock=${snapshot.app.screenWakeLock}`)
  parts.push(`locale=${snapshot.app.locale}`)
  parts.push(`theme=${snapshot.app.theme}`)

  return parts.join(" ")
}
