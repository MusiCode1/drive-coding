import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { buildVersion } from "./binary.js"

/**
 * Resolve the running app's version.
 *
 * Binary: returns the version injected at compile time via --define __BUILD_VERSION__="<semver>".
 * Bundle/dev: falls back to reading from the nearest package.json on disk.
 *
 * Mirrors the candidate-path resolution the CLI `--version` flag uses in
 * `bin/drive-coding.ts`, so the HTTP `/api/health` version stays consistent with it:
 * - **release** (bundled `dist/drive-coding.js`): `import.meta.dirname` = `dist/` →
 *   `../package.json` = the published `drive-coding` package version.
 * - **dev** (`packages/backend/src/app-version.ts`): `import.meta.dirname` =
 *   `packages/backend/src` → `../package.json` = the `@drive-coding/backend` version.
 *
 * Returns `"unknown"` if no package.json is found or it is unparseable — never throws.
 */
export function resolveAppVersion(): string {
  const compiled = buildVersion()
  if (compiled !== undefined) return compiled

  const candidates = [
    path.resolve(import.meta.dirname, "../package.json"),
    path.resolve(import.meta.dirname, "../../package.json"),
  ]
  const pkgPath = candidates.find(existsSync)
  if (pkgPath === undefined) return "unknown"
  try {
    return (JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string }).version ?? "unknown"
  } catch {
    return "unknown"
  }
}
