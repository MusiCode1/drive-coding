import type { SessionConfigOption } from "@agentclientprotocol/sdk"

type SessionModelState = {
  currentModelId: string
  availableModels: Array<{ modelId: string; name: string; description?: string | null }>
}

type ConfigChoiceVm = {
  modes: { availableModes: Array<{ id: string }>; currentModeId: string } | null
  models: SessionModelState | null
  configOptions: SessionConfigOption[]
}

/**
 * האם value עדיין תקף מול ה-options שה-CLI מחזיר כרגע?
 * בודק ערך (לא רק קיום option) — ערך stale שה-CLI הסיר נדלג בשקט.
 *
 * מבנים מאומתים מול dev:
 *   modes.availableModes[].id
 *   models.availableModels[].modelId (לא .id!)
 *   SessionConfigOption = discriminated union { type:"select"|"boolean" }
 */
export function isValidChoice(vm: ConfigChoiceVm, key: string, value: string | boolean): boolean {
  if (key === "mode" && vm.modes) {
    return typeof value === "string" && vm.modes.availableModes.some((m) => m.id === value)
  }
  if (key === "model" && vm.models) {
    return typeof value === "string" && vm.models.availableModels.some((m) => m.modelId === value)
  }
  const opt = vm.configOptions.find((o) => o.id === key || o.category === key)
  if (!opt) return false
  if (opt.type === "select" && typeof value === "string") {
    // flatten זהה ללוגיקה של flattenSelectOptions (SessionOptionsPanel) — inline ב-VM
    const flat = (
      opt.options as Array<{ value?: string; options?: Array<{ value: string }> }>
    ).flatMap((i) => ("options" in i && i.options ? i.options : [i as { value: string }]))
    return flat.some((c) => c.value === value)
  }
  if (opt.type === "boolean") return typeof value === "boolean"
  return true
}
