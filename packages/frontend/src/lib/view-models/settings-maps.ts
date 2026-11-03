/**
 * settings-maps.ts — the keyed settings maps, and the only real behaviour in `Settings`.
 *
 * Extracted while adding `defaultNewCwd`. The criterion is not convenience: `Settings` is
 * a 500-line list of `set x = v; persist()`, and these two are the only members that
 * *compute* anything — an immutable nested replacement, which is easy to get subtly wrong
 * and impossible to test while it is a method on a `$state` class.
 */

export type ProjectPromptMap = Record<string, string>

/** The stored prompt for a project folder, or an empty string when there is none. */
export function projectPromptFor(map: ProjectPromptMap, cwd: string): string {
  return map[cwd] ?? ""
}

/**
 * The map with `cwd`'s prompt replaced.
 *
 * 🔑 Returns a **new object** rather than mutating. The caller assigns it back to a
 * `$state` field, and an in-place mutation of the same reference would not be seen as a
 * change — the prompt would save but never re-render.
 */
export function withProjectPrompt(
  map: ProjectPromptMap,
  cwd: string,
  text: string,
): ProjectPromptMap {
  return { ...map, [cwd]: text }
}

export type LastConfigMap = Record<string, Record<string, string | boolean>>

/**
 * The per-CLI config map with one option replaced, **merging** rather than overwriting
 * the CLI's other options.
 *
 * Two levels of spread, for the same reactivity reason as above: the outer object must be
 * new for `$state` to notice, and the inner one must be new or the sibling options of
 * that CLI would be dropped.
 */
export function withLastConfig(
  map: LastConfigMap,
  cliKind: string,
  configId: string,
  value: string | boolean,
): LastConfigMap {
  return { ...map, [cliKind]: { ...(map[cliKind] ?? {}), [configId]: value } }
}
