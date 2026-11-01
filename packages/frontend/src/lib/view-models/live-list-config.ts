import type { SessionConfigOption } from "@agentclientprotocol/sdk"
import {
  type ConfigChoice,
  formatListConfigSnapshot,
  type ListConfigInput,
  type ListConfigOptionInput,
} from "@drive-coding/core/voice/live-config"
import type { AgentSession } from "./agent-session.svelte"
import type { Settings } from "./settings.svelte"
import { PALETTES, type ThemeVM } from "./theme.svelte"

type SelectOpt = { value: string; name: string }

function flattenSelectOptions(option: SessionConfigOption): SelectOpt[] {
  if (option.type !== "select") return []
  const sel = option as Extract<SessionConfigOption, { type: "select" }>
  return sel.options.flatMap((item) =>
    "options" in item
      ? item.options.map((o) => ({ value: o.value, name: o.name }))
      : [{ value: item.value, name: item.name }],
  )
}

function toConfigChoices(items: SelectOpt[]): ConfigChoice[] {
  return items.map((o) => ({ id: o.value, name: o.name }))
}

export type LiveListConfigDeps = {
  session: AgentSession
  settings: Settings
  theme: ThemeVM
}

export function buildListConfigInput(deps: LiveListConfigDeps): ListConfigInput {
  const s = deps.session
  const settings = deps.settings
  const theme = deps.theme

  const options: ListConfigOptionInput[] = []
  const sessionPart: ListConfigInput["session"] & { options: ListConfigOptionInput[] } = {
    connected: s.status === "connected",
    options,
  }

  const configOptions = s.config.configOptions ?? []

  if ((s.config.models?.availableModels?.length ?? 0) > 0) {
    const models = s.config.models!
    const current = models.availableModels.find((m) => m.modelId === models.currentModelId)
    sessionPart.model = {
      id: models.currentModelId,
      name: current?.name,
      choices: models.availableModels.map((m) => ({ id: m.modelId, name: m.name })),
    }
  } else {
    const modelOpt = configOptions.find((o) => o.category === "model")
    if (modelOpt?.type === "select") {
      const choices = flattenSelectOptions(modelOpt)
      if (choices.length > 0) {
        sessionPart.model = {
          id: modelOpt.currentValue ?? "",
          name: modelOpt.name,
          choices: toConfigChoices(choices),
        }
      }
    }
  }

  if ((s.config.modes?.availableModes?.length ?? 0) > 0) {
    const modes = s.config.modes!
    const current = modes.availableModes.find((m) => m.id === modes.currentModeId)
    sessionPart.mode = {
      id: modes.currentModeId,
      name: current?.name,
      choices: modes.availableModes.map((m) => ({ id: m.id, name: m.name })),
    }
  } else {
    const modeOpt = configOptions.find((o) => o.category === "mode")
    if (modeOpt?.type === "select") {
      const choices = flattenSelectOptions(modeOpt)
      if (choices.length > 0) {
        sessionPart.mode = {
          id: modeOpt.currentValue ?? "",
          name: modeOpt.name,
          choices: toConfigChoices(choices),
        }
      }
    }
  }

  const extraOptions = configOptions.filter((o) => o.category !== "model" && o.category !== "mode")
  for (const opt of extraOptions) {
    if (opt.type === "select") {
      const choices = flattenSelectOptions(opt)
      if (choices.length === 0) continue
      options.push({
        id: opt.id,
        name: opt.name,
        type: "select",
        current: opt.currentValue ?? null,
        choices: toConfigChoices(choices),
      })
    } else if (opt.type === "boolean") {
      options.push({
        id: opt.id,
        name: opt.name,
        type: "boolean",
        current: opt.currentValue,
      })
    }
  }

  if (s.supports?.thinkingTokens) {
    sessionPart.thinkingAvailable = true
  }

  return {
    session: sessionPart,
    app: {
      screenWakeLock: settings.screenWakeLock,
      locale: settings.locale,
      theme: theme.palette,
      themeChoices: [...PALETTES],
    },
  }
}

export function validateSessionConfigValue(
  deps: LiveListConfigDeps,
  id: string,
  rawValue: string,
): { ok: true; parsed: string | boolean } | { ok: false; reason: "unknown-id" | "invalid-value" } {
  const snap = formatListConfigSnapshot(buildListConfigInput(deps))

  if (id === "model") {
    if (!snap.session.model) return { ok: false, reason: "unknown-id" }
    if (!snap.session.model.choices.some((c) => c.id === rawValue)) {
      return { ok: false, reason: "invalid-value" }
    }
    return { ok: true, parsed: rawValue }
  }

  if (id === "mode") {
    if (!snap.session.mode) return { ok: false, reason: "unknown-id" }
    if (!snap.session.mode.choices.some((c) => c.id === rawValue)) {
      return { ok: false, reason: "invalid-value" }
    }
    return { ok: true, parsed: rawValue }
  }

  const opt = snap.session.options.find((o) => o.id === id)
  if (!opt) return { ok: false, reason: "unknown-id" }

  if (opt.type === "boolean") {
    if (rawValue !== "true" && rawValue !== "false") {
      return { ok: false, reason: "invalid-value" }
    }
    return { ok: true, parsed: rawValue === "true" }
  }

  if (!opt.choices?.some((c) => c.id === rawValue)) {
    return { ok: false, reason: "invalid-value" }
  }
  return { ok: true, parsed: rawValue }
}
