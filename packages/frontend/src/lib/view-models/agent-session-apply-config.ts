import type { SessionConfigOption } from "@agentclientprotocol/sdk"
import type { AcpClient } from "@drive-coding/provider/client"
import type { SessionView } from "$lib/session/session-view"
import type { Settings } from "$lib/view-models/settings.svelte"
import { isValidChoice } from "./agent-session-config-choice"

type SessionModelState = {
  currentModelId: string
  availableModels: Array<{ modelId: string; name: string; description?: string | null }>
}

type SessionModeState = {
  currentModeId: string
  availableModes: Array<{ id: string; name: string }>
}

export type ApplyConfigToClientDeps = {
  isCurrent: () => boolean
  configOptions: () => SessionConfigOption[]
  setConfigOptions: (v: SessionConfigOption[]) => void
  client: () => AcpClient | null
  sessionId: () => string | null
  models: () => SessionModelState | null
  setModels: (v: SessionModelState | null) => void
  modes: () => SessionModeState | null
  setModes: (v: SessionModeState | null) => void
}

/**
 * הגוף הפנימי של apply. מחזיר true בכל מסלול-הצלחה, false אם configId לא נמצא.
 * מניח ש-guard (status, #client, #sessionId) כבר עבר בקורא.
 */
export async function applyConfigToClient(
  d: ApplyConfigToClientDeps,
  configId: string,
  value: string | boolean,
): Promise<boolean> {
  if (!d.isCurrent()) return false
  // מסלול 1: option קיים ב-configOptions לפי id
  const optById = d.configOptions().find((o) => o.id === configId)
  if (optById) {
    const res = await d.client()!.setSessionConfigOption({
      sessionId: d.sessionId()!,
      configId,
      value,
    })
    if (!d.isCurrent()) return false
    d.setConfigOptions(res.configOptions)
    return true
  }

  // מסלול 2: fallback key "model"/"mode" — חפש לפי category
  if (configId === "model" && typeof value === "string") {
    const byCat = d.configOptions().find((o) => o.category === "model")
    if (byCat) {
      const res = await d.client()!.setSessionConfigOption({
        sessionId: d.sessionId()!,
        configId: byCat.id,
        value,
      })
      if (!d.isCurrent()) return false
      d.setConfigOptions(res.configOptions)
      return true
    }
    // fallback — setSessionModel ישיר; עדכן models ידנית למניעת UI desync
    await d.client()!.setSessionModel({ sessionId: d.sessionId()!, modelId: value })
    if (!d.isCurrent()) return false
    const models = d.models()
    if (models) d.setModels({ ...models, currentModelId: value })
    return true
  }
  if (configId === "mode" && typeof value === "string") {
    const byCat = d.configOptions().find((o) => o.category === "mode")
    if (byCat) {
      const res = await d.client()!.setSessionConfigOption({
        sessionId: d.sessionId()!,
        configId: byCat.id,
        value,
      })
      if (!d.isCurrent()) return false
      d.setConfigOptions(res.configOptions)
      return true
    }
    // fallback — setSessionMode ישיר; עדכן modes ידנית
    await d.client()!.setSessionMode({ sessionId: d.sessionId()!, modeId: value })
    if (!d.isCurrent()) return false
    const modes = d.modes()
    if (modes) d.setModes({ ...modes, currentModeId: value })
    return true
  }

  // מסלול 3: לא נמצא — skip בשקט
  console.warn(`[AgentSession] configId "${configId}" not available — skipping`)
  return false
}

type AgentSessionStatus = "idle" | "connecting" | "connected" | "error" | "disconnected"

export type ApplyConfigOptionDeps = ApplyConfigToClientDeps & {
  status: () => AgentSessionStatus
  remoteView: () => SessionView | null
  cliKind: () => string | null
  settings: () => Settings | undefined
}

/**
 * מחיל שינוי config על הסשן הפתוח. קורא ל-setSessionConfigOption עם
 * discriminated fallback ל-setSessionModel/setSessionMode.
 * מדלג בשקט אם הסשן לא מחובר.
 *
 * ─── slice-restore-last-config: wrapper ───
 * הגוף האמיתי הועבר ל-#applyConfigToClient שמחזיר boolean (הצליח/לא נמצא).
 * guard של status/client+sessionId נשאר כאן.
 * persist נקרא רק אם applied===true — כיסוי כל 5 מסלולי-ההצלחה.
 */
export async function applyConfigOption(
  d: ApplyConfigOptionDeps,
  configId: string,
  value: string | boolean,
): Promise<void> {
  try {
    await applyCurrentConfigOption(d, configId, value)
  } catch (error) {
    if (d.isCurrent()) throw error
  }
}

async function applyCurrentConfigOption(
  d: ApplyConfigOptionDeps,
  configId: string,
  value: string | boolean,
): Promise<void> {
  if (!d.isCurrent() || d.status() !== "connected") return
  // ─── slice view-switch C3-ד: guard view-aware — אחרת כל נתיב ה-config ב-remote no-op שקט ───
  if (!d.remoteView() && (!d.client() || !d.sessionId())) return
  let applied: boolean
  const remoteView = d.remoteView()
  if (remoteView) {
    // ⚠️ ה-UI שולח ids סינתטיים ("mode"/"model") — שקילות ל-local חייבת לחקות את
    // שלושת השלבים של #applyConfigToClient, לא רק את ה-fallback האחרון.
    const byId = d.configOptions().find((o) => o.id === configId)
    // חיפוש-קטגוריה — רק "mode"/"model", ורק כש-value הוא string (כמו local)
    const byCat =
      !byId && typeof value === "string" && (configId === "mode" || configId === "model")
        ? d.configOptions().find((o) => o.category === configId)
        : undefined
    const opt = byId ?? byCat
    if (opt) {
      await remoteView.setConfigOption(opt.id, value)
      applied = true
    } else if (configId === "mode" && typeof value === "string") {
      await remoteView.setMode(value)
      applied = true
    } else if (configId === "model" && typeof value === "string") {
      await remoteView.setSessionModel(value)
      applied = true
    } else {
      // ⚠️ כמו local: לא נמצא = skip בשקט
      applied = false
    }
    // ⚠️ ב-local #applyConfigToClient מעדכן ידנית גם this.modes/this.models מתשובת
    // ה-RPC. ב-remote אין תשובה כזו — יתעדכנו רק כשיגיע *_update מה-wire. known-gap
    // מתועד (runbook C4) — ❌ אל תזייף עדכון מקומי.
  } else {
    applied = await applyConfigToClient(d, configId, value)
  }
  if (!d.isCurrent()) return
  const cli = d.cliKind()
  if (applied && d.settings() && cli) {
    d.settings()!.setLastConfig(cli, configId, value)
  }
}

/** Bind immutable RPC destinations; metadata remains fresh while that target is current. */
export function bindConfigDeps(
  d: Omit<ApplyConfigOptionDeps, "isCurrent">,
  isCurrent: () => boolean,
): ApplyConfigOptionDeps {
  const client = d.client()
  const sessionId = d.sessionId()
  const remoteView = d.remoteView()
  const cliKind = d.cliKind()
  const settings = d.settings()
  return {
    isCurrent,
    configOptions: () => (isCurrent() ? d.configOptions() : []),
    setConfigOptions: (value) => {
      if (isCurrent()) d.setConfigOptions(value)
    },
    client: () => client,
    sessionId: () => sessionId,
    models: () => (isCurrent() ? d.models() : null),
    setModels: (value) => {
      if (isCurrent()) d.setModels(value)
    },
    modes: () => (isCurrent() ? d.modes() : null),
    setModes: (value) => {
      if (isCurrent()) d.setModes(value)
    },
    remoteView: () => remoteView,
    cliKind: () => cliKind,
    settings: () => settings,
    status: () => (isCurrent() ? d.status() : "idle"),
  }
}

/** One target and remembered-key snapshot for the complete restoration loop. */
export async function restoreRememberedConfig(d: ApplyConfigOptionDeps): Promise<void> {
  const cli = d.cliKind()
  const remembered = cli ? d.settings()?.lastConfig[cli] : undefined
  if (!remembered) return
  const entries = Object.entries(remembered)
  for (const [key, value] of entries) {
    if (!d.isCurrent()) return
    const choice = { configOptions: d.configOptions(), models: d.models(), modes: d.modes() }
    if (isValidChoice(choice, key, value)) await applyConfigOption(d, key, value)
  }
}
