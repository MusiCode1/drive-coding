/**
 * Pure helpers for static file serving — path validation logic.
 *
 * Extracted from `server.ts` so it can be tested without spinning up
 * `Bun.serve` or touching the filesystem.
 *
 * Behaviors documented in `docs/behaviors.md` (STATIC-1..STATIC-3).
 */

import { resolve } from "node:path";

/**
 * Result of resolving a static path. If `error` is set, the caller should
 * respond with that HTTP status. Otherwise `filePath` is the absolute,
 * verified-safe path to read.
 */
export type StaticPathResult =
  | { ok: true; filePath: string }
  | { ok: false; status: number; message: string };

/**
 * Resolves a request pathname to a safe file path within `frontendDir`.
 *
 * Returns:
 *   - `{ ok: true, filePath }` — safe to serve.
 *   - `{ ok: false, status: 400, ... }` — path contains `..` or null byte.
 *   - `{ ok: false, status: 403, ... }` — resolves outside `frontendDir`.
 *
 * `/` is rewritten to `/index.html` (STATIC-2).
 */
export function resolveStaticPath(
  pathname: string,
  frontendDir: string,
): StaticPathResult {
  if (pathname.includes("..") || pathname.includes("\0")) {
    return { ok: false, status: 400, message: "Bad request" };
  }
  const relative = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolve(frontendDir, "." + relative);
  if (!filePath.startsWith(frontendDir)) {
    return { ok: false, status: 403, message: "Forbidden" };
  }
  return { ok: true, filePath };
}
