/**
 * `GET /api/ls?path=&showHidden=` handler — directory listing with
 * security restrictions.
 *
 * Security:
 *   - path must be absolute (start with `/`).
 *   - path must be under `$HOME` or `/tmp` (not arbitrary).
 *   - dot-folders filtered unless `showHidden=1`.
 *
 * Returns: `{ path, parent, home, entries: [{name, type}] }`.
 *
 * Behaviors documented in `docs/behaviors.md` (HTTP-10..HTTP-16).
 */

import { dirname, sep as PATH_SEP } from "node:path";

export interface DirEntry {
  name: string;
  type: "directory";
}

export type LsResult =
  | {
      ok: true;
      body: {
        path: string;
        parent: string | null;
        home: string;
        entries: DirEntry[];
      };
    }
  | { ok: false; status: number; body: { error: string } };

export interface LsDeps {
  /** $HOME — used as one of the allowed roots. */
  home: string;
  /**
   * List directory entries. Returns objects with `isDirectory()` and
   * `name`. Errors propagate.
   */
  readDirectory(path: string): Promise<
    Array<{ name: string; isDirectory(): boolean }>
  >;
}

/** Check whether `path` is inside one of the `allowed` roots. */
function isUnderRoot(path: string, roots: string[]): boolean {
  return roots.some(
    (root) => path === root || path.startsWith(root + PATH_SEP),
  );
}

/**
 * Validates path + lists directory + returns sorted entries.
 *
 * Pure logic — caller wraps in Response.
 */
export async function handleApiLs(
  path: string,
  showHidden: boolean,
  deps: LsDeps,
): Promise<LsResult> {
  if (!path.startsWith("/")) {
    return {
      ok: false,
      status: 400,
      body: { error: "path חייב להיות absolute" },
    };
  }
  const allowed = [deps.home, "/tmp"];
  if (!isUnderRoot(path, allowed)) {
    return {
      ok: false,
      status: 403,
      body: {
        error: `path מחוץ לטווח המותר (מותר רק תחת ${deps.home} או /tmp)`,
      },
    };
  }

  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await deps.readDirectory(path);
  } catch (e) {
    return {
      ok: false,
      status: 500,
      body: { error: String((e as Error).message ?? e) },
    };
  }

  const dirs: DirEntry[] = entries
    .filter((e) => {
      if (!e.isDirectory()) return false;
      if (!showHidden && e.name.startsWith(".")) return false;
      return true;
    })
    .map((e) => ({ name: e.name, type: "directory" as const }))
    .sort((a, b) => a.name.localeCompare(b.name, "he"));

  // Parent — only if it's also within the allowed roots.
  let parent: string | null = path === "/" ? null : dirname(path);
  if (parent && !isUnderRoot(parent, allowed)) {
    parent = null;
  }

  return {
    ok: true,
    body: {
      path,
      parent,
      home: deps.home,
      entries: dirs,
    },
  };
}
