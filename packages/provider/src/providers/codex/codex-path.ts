/**
 * codex-path.ts — locating the native codex binary (moved out of the codex in-process connection).
 */

import * as os from "node:os"
import * as path from "node:path"
import { resolveCliBinary } from "@drive-coding/core/cli-resolve"

/**
 * resolveCodexPath — finds the native codex binary using resolveCliBinary.
 *
 * Resolution order (via resolveCliBinary):
 *   1. CODEX_PATH env var (explicit override).
 *   2. PATH scan (with PATHEXT on Windows).
 *   3. pm-global-bins (~/.bun/bin, npm global, ~/.local/bin, /usr/local/bin, etc.).
 *   4. Known codex install locations per platform.
 *   5. undefined — startAcpServer will attempt its bundled binary (works on Linux/Termux,
 *      broken on Windows; calev verifies the no-CODEX_PATH case out-of-box).
 */
export function resolveCodexPath(): string | undefined {
  const home = os.homedir()
  return resolveCliBinary({
    bin: "codex",
    envVar: "CODEX_PATH",
    knownPaths: [
      // Windows: OpenAI Codex typical install locations
      path.join(home, "AppData", "Local", "Programs", "OpenAI", "Codex", "bin"),
      path.join(home, "AppData", "Local", "Programs", "OpenAI", "Codex"),
      // WinGet links
      path.join(home, "AppData", "Local", "Microsoft", "WinGet", "Links"),
      // npm global bin (common on Windows with npm -g install)
      path.join(home, "AppData", "Roaming", "npm"),
      // Scoop
      path.join(home, "scoop", "shims"),
      // Linux/macOS: nvm / volta / asdf shims (often not in PATH in non-interactive shells)
      path.join(home, ".volta", "bin"),
      path.join(home, ".nvm", "bin"),
    ],
  })
}
