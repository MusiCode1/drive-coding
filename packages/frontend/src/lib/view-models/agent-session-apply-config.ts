import type { SessionConfigOption } from "@agentclientprotocol/sdk"
import type { SessionView } from "$lib/session/session-view"
import type { Settings } from "$lib/view-models/settings.svelte"

type AgentSessionStatus = "idle" | "connecting" | "connected" | "error" | "disconnected"

export type ApplyConfigOptionDeps = {
  configOptions: () => SessionConfigOption[]
  status: () => AgentSessionStatus
  view: () => SessionView | null
  cliKind: () => string | null
  settings: () => Settings | undefined
}

/** Sends a configuration change through the session view and remembers it on success. */
export async function applyConfigOption(
  d: ApplyConfigOptionDeps,
  configId: string,
  value: string | boolean,
): Promise<void> {
  if (d.status() !== "connected") return
  const view = d.view()
  if (!view) return

  const byId = d.configOptions().find((o) => o.id === configId)
  // חיפוש-קטגוריה — רק "mode"/"model", ורק כש-value הוא string (כמו local)
  const byCat =
    !byId && typeof value === "string" && (configId === "mode" || configId === "model")
      ? d.configOptions().find((o) => o.category === configId)
      : undefined
  const opt = byId ?? byCat
  if (opt) {
    await view.setConfigOption(opt.id, value)
  } else if (configId === "mode" && typeof value === "string") {
    await view.setMode(value)
  } else if (configId === "model" && typeof value === "string") {
    await view.setSessionModel(value)
  } else {
    return
  }
  const cli = d.cliKind()
  if (cli) d.settings()?.setLastConfig(cli, configId, value)
}
