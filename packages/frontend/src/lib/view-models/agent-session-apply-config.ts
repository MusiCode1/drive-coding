import type { SessionConfigOption } from "@agentclientprotocol/sdk"
import type { AcpClient } from "@drive-coding/provider/client"
import type { SessionView } from "$lib/session/session-view"
import type { Settings } from "$lib/view-models/settings.svelte"

type SessionModelState = {
  currentModelId: string
  availableModels: Array<{ modelId: string; name: string; description?: string | null }>
}

type SessionModeState = {
  currentModeId: string
  availableModes: Array<{ id: string; name: string }>
}

export type ApplyConfigToClientDeps = {
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
  // מסלול 1: option קיים ב-configOptions לפי id
  const optById = d.configOptions().find((o) => o.id === configId)
  if (optById) {
    const res = await d.client()!.setSessionConfigOption({
      sessionId: d.sessionId()!,
      configId,
      value,
    })
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
      d.setConfigOptions(res.configOptions)
      return true
    }
    // fallback — setSessionModel ישיר; עדכן models ידנית למניעת UI desync
    await d.client()!.setSessionModel({ sessionId: d.sessionId()!, modelId: value })
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
      d.setConfigOptions(res.configOptions)
      return true
    }
    // fallback — setSessionMode ישיר; עדכן modes ידנית
    await d.client()!.setSessionMode({ sessionId: d.sessionId()!, modeId: value })
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
  if (d.status() !== "connected") return
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
  const cli = d.cliKind()
  if (applied && d.settings() && cli) {
    d.settings()!.setLastConfig(cli, configId, value)
  }
}
