export type SessionMetaConflict = {
  path: string
  base: unknown
  override: unknown
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Deep-merge sessionMeta overrides: objects recurse; arrays and primitives replace.
 * Conflicts = override leaf differs from an existing base leaf at the same path.
 */
export function deepMergeSessionMeta(
  base: unknown,
  override: unknown,
  prefix = "",
): { merged: Record<string, unknown>; conflicts: SessionMetaConflict[] } {
  const baseObj = isPlainObject(base) ? base : {}
  const overrideObj = isPlainObject(override) ? override : {}
  const conflicts: SessionMetaConflict[] = []
  const merged: Record<string, unknown> = { ...baseObj }

  for (const [key, overrideValue] of Object.entries(overrideObj)) {
    const path = prefix ? `${prefix}.${key}` : key
    const baseValue = baseObj[key]
    if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
      const nested = deepMergeSessionMeta(baseValue, overrideValue, path)
      merged[key] = nested.merged
      conflicts.push(...nested.conflicts)
    } else if (key in baseObj && baseValue !== overrideValue) {
      conflicts.push({ path, base: baseValue, override: overrideValue })
      merged[key] = overrideValue
    } else {
      merged[key] = overrideValue
    }
  }

  return { merged, conflicts }
}

/** Collect dotted paths for nested conflicts (used by loadCliSpecsOverride warnings). */
export function collectSessionMetaConflicts(
  base: unknown,
  override: unknown,
  prefix = "",
): SessionMetaConflict[] {
  const baseObj = isPlainObject(base) ? base : {}
  const overrideObj = isPlainObject(override) ? override : {}
  const conflicts: SessionMetaConflict[] = []

  for (const [key, overrideValue] of Object.entries(overrideObj)) {
    const path = prefix ? `${prefix}.${key}` : key
    const baseValue = baseObj[key]
    if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
      conflicts.push(...collectSessionMetaConflicts(baseValue, overrideValue, path))
    } else if (key in baseObj && baseValue !== overrideValue) {
      conflicts.push({ path, base: baseValue, override: overrideValue })
    }
  }

  return conflicts
}
