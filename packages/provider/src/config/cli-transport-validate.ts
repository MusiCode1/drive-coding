/**
 * cli-transport-validate.ts — runtime validation of the `transport` / `fs`
 * fields of a cli-specs.jsonc override (slice cli-transport).
 *
 * Same tolerant, hand-rolled style as `validateOverride` in cli-config-file.ts:
 * a bad field is dropped with a warning, never thrown. Kept in its own module so
 * the loader stays under its size budget.
 */

import {
  type CliFs,
  type CliTransport,
  TRANSPORT_MODES,
  type TransportMode,
} from "@drive-coding/core"

/**
 * Validates a `transport` override. `mode` is required and must be a known
 * TransportMode; `mode:"unix"` additionally requires a socket location. A bad
 * transport is dropped whole (returns undefined) with a warning — the spec then
 * falls back to the default `stdio` transport.
 */
export function validateTransport(kind: string, raw: unknown): CliTransport | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    console.warn(`[cli-config-file] override["${kind}"].transport must be an object — skipping`)
    return undefined
  }
  const obj = raw as Record<string, unknown>
  const mode = obj["mode"]
  if (typeof mode !== "string" || !(TRANSPORT_MODES as readonly string[]).includes(mode)) {
    console.warn(
      `[cli-config-file] override["${kind}"].transport.mode must be one of ${TRANSPORT_MODES.join("|")} — skipping transport`,
    )
    return undefined
  }
  const str = (field: "socketPath" | "socketDir" | "httpUrl"): string | undefined => {
    if (!(field in obj)) return undefined
    if (typeof obj[field] === "string") return obj[field] as string
    console.warn(
      `[cli-config-file] override["${kind}"].transport.${field} must be a string — skipping field`,
    )
    return undefined
  }
  const bool = (field: "sidecar" | "attachOnly"): boolean | undefined => {
    if (!(field in obj)) return undefined
    if (typeof obj[field] === "boolean") return obj[field] as boolean
    console.warn(
      `[cli-config-file] override["${kind}"].transport.${field} must be a boolean — skipping field`,
    )
    return undefined
  }
  const socketPath = str("socketPath")
  const socketDir = str("socketDir")
  if (mode === "unix" && socketPath === undefined && socketDir === undefined) {
    console.warn(
      `[cli-config-file] override["${kind}"].transport.mode="unix" requires socketPath or socketDir — skipping transport`,
    )
    return undefined
  }
  return {
    mode: mode as TransportMode,
    ...(socketPath !== undefined ? { socketPath } : {}),
    ...(socketDir !== undefined ? { socketDir } : {}),
    ...(str("httpUrl") !== undefined ? { httpUrl: str("httpUrl") } : {}),
    ...(bool("sidecar") !== undefined ? { sidecar: bool("sidecar") } : {}),
    ...(bool("attachOnly") !== undefined ? { attachOnly: bool("attachOnly") } : {}),
  }
}

/**
 * Validates an `fs` override. `kind` must be "local" or "webdav"; webdav requires
 * url/user/root and one of pass/passEnv. Invalid → undefined + warning, and the
 * spec falls back to local fs.
 */
export function validateFs(kind: string, raw: unknown): CliFs | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    console.warn(`[cli-config-file] override["${kind}"].fs must be an object — skipping`)
    return undefined
  }
  const obj = raw as Record<string, unknown>
  const fsKind = obj["kind"]
  if (fsKind === "local") return { kind: "local" }
  if (fsKind !== "webdav") {
    console.warn(
      `[cli-config-file] override["${kind}"].fs.kind must be "local" or "webdav" — skipping fs`,
    )
    return undefined
  }
  const { url, user, root, pass, passEnv } = obj
  if (typeof url !== "string" || typeof user !== "string" || typeof root !== "string") {
    console.warn(
      `[cli-config-file] override["${kind}"].fs webdav requires string url/user/root — skipping fs`,
    )
    return undefined
  }
  if (typeof pass !== "string" && typeof passEnv !== "string") {
    console.warn(
      `[cli-config-file] override["${kind}"].fs webdav requires pass or passEnv — skipping fs`,
    )
    return undefined
  }
  return {
    kind: "webdav",
    url,
    user,
    root,
    ...(typeof pass === "string" ? { pass } : {}),
    ...(typeof passEnv === "string" ? { passEnv } : {}),
  }
}
