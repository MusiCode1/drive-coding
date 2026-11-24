import type { SessionConfigOption } from "@agentclientprotocol/sdk"
import type { MessageKey } from "@drive-coding/core/i18n"

type SelectItem = { value: string; name: string; description?: string | null }

export function flattenSelectOptions(option: SessionConfigOption): SelectItem[] {
  if (option.type !== "select") return []
  return option.options.flatMap((item) => ("options" in item ? item.options : [item]))
}

export function toSelectOptions(items: SelectItem[]) {
  return items.map((item) => ({
    value: item.value,
    label: item.name,
    description: item.description,
  }))
}

const CONFIG_NAME_KEYS: Record<string, MessageKey> = {
  agent: "configName.agent",
  mode: "configName.mode",
  "session mode": "configName.sessionMode",
  "approval preset": "configName.approvalPreset",
  model: "configName.model",
  effort: "configName.effort",
  "reasoning effort": "configName.reasoningEffort",
}

export function localizeConfigName(name: string, translate: (key: MessageKey) => string): string {
  const key = CONFIG_NAME_KEYS[name.trim().toLowerCase()]
  return key ? translate(key) : name
}
