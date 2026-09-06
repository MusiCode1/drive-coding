/**
 * Resolve a process cwd that exists on this host.
 * Session cwd may point at a remote path (sibling/SSH agent); spawn still needs a local dir.
 */
import { existsSync } from "node:fs"
import { homedir, tmpdir } from "node:os"

export function resolveSpawnCwd(requestedCwd: string): string {
  if (existsSync(requestedCwd)) return requestedCwd
  if (existsSync(homedir())) return homedir()
  return tmpdir()
}
