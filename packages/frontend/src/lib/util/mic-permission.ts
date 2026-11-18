/**
 * probeMicPermission — Permissions API readout for microphone (best-effort).
 * Returns "unknown" when the API is missing or rejects (common on some WebViews).
 */
export type MicPermissionState = "granted" | "denied" | "prompt" | "unknown"

export async function probeMicPermission(): Promise<MicPermissionState> {
  try {
    const perms = navigator.permissions
    if (!perms?.query) return "unknown"
    // `microphone` is not in all TS lib DOM typings; cast the name.
    const status = await perms.query({ name: "microphone" as PermissionName })
    if (status.state === "granted" || status.state === "denied" || status.state === "prompt") {
      return status.state
    }
    return "unknown"
  } catch {
    return "unknown"
  }
}
