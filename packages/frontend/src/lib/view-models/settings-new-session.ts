/**
 * settings-new-session.ts — how a `/chat/<cli>/new` link picks its folder.
 */

/**
 * How a `/chat/<cli>/new` link resolves its folder, as decided on 2026-09-10
 * (`pre-brief-chat-new-open-routes.md` §7#1):
 *
 * ```
 * ?cwd=<path>          explicit deep link, wins
 *   ↓ empty
 * defaultNewCwd        this setting
 *   ↓ empty
 * folder picker        no silent spawn on a guess
 * ```
 *
 * 🛑 Only **absolute** paths are accepted. A relative default would have to be joined to
 * the home directory at spawn time, which is the "spawn on a guess" the same decision
 * forbids — the user would ask for one folder and silently land in another.
 */
export function resolveDefaultNewCwd(stored: string | null | undefined): string | null {
  const trimmed = stored?.trim()
  if (!trimmed) return null
  return isAbsoluteProjectPath(trimmed) ? trimmed : null
}

const WINDOWS_DRIVE_RE = /^[a-zA-Z]:[\\/]/

export function isAbsoluteProjectPath(path: string): boolean {
  return path.startsWith("/") || WINDOWS_DRIVE_RE.test(path) || path.startsWith("\\\\")
}
