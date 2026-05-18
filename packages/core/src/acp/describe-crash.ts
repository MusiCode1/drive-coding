/**
 * describeCrash — pure helper that builds a human-readable crash reason
 * from bridge exit information + stderr.
 *
 * Priority order (highest wins):
 *   1. Provider error extracted from stderr (extractProviderError)
 *      — most useful: "Your credit balance is too low"
 *   2. Spawn error (ENOENT, EACCES, etc.)
 *      — e.g. "ENOENT: spawn npx ENOENT"
 *   3. Signal (SIGKILL, SIGTERM, etc.)
 *      — e.g. "Killed by signal SIGKILL"
 *   4. Non-zero exit code
 *      — e.g. "Exited with code 127"
 *   5. undefined — clean exit (code 0) or truly no info
 *
 * All strings are English/technical — UI layer adds locale labels on top.
 */

import { extractProviderError } from "./provider-error.js"

export type BridgeCrashInfo = {
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | string | null
  /** Populated when crash originates from child.on("error") — spawn ENOENT etc. */
  readonly spawnError?: { readonly code?: string; readonly message: string }
}

export function describeCrash(
  info: BridgeCrashInfo,
  stderrLines: ReadonlyArray<string>,
): string | undefined {
  // 1. Provider error from stderr (LLM API 400/401/429)
  const provider = extractProviderError(stderrLines as string[])
  if (provider) return provider

  // 2. Spawn error (ENOENT, EACCES, etc.)
  if (info.spawnError) {
    const { code, message } = info.spawnError
    return code ? `${code}: ${message}` : message
  }

  // 3. Signal
  if (info.signal) return `Killed by signal ${info.signal}`

  // 4. Non-zero exit code
  if (info.exitCode !== null && info.exitCode !== 0) {
    return `Exited with code ${info.exitCode}`
  }

  // 5. Clean exit or no info — no reason to surface
  return undefined
}
