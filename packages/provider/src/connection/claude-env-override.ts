/**
 * claude-env-override.ts — env shaping for claude in-process (SDK channel).
 *
 * In-process claude uses _meta.claudeCode.options.env as the env channel.
 * The SDK merges it over process.env (createSession), and Node drops keys
 * with value undefined on spawn — giving us unset semantics without mutating
 * process.env globally.
 *
 * This mirrors the semantics of spawn-core.ts (for spawn-path CLIs):
 *   for (key of unsetEnv) delete env[key]   → here: key = undefined
 *   Object.assign(env, setEnv)               → here: key = string
 *
 * Verified (§3 findings):
 *   - claude-agent-acp 0.52.0 merges userProvidedOptions.env after process.env
 *     (createSession, dist/acp-agent.js:2422-2428).
 *   - claude-agent-sdk initialize() passes env verbatim to spawn (no re-merge).
 *   - Node: key=undefined in spawn env → key absent in child (empirically verified).
 */

import type { CliSpec } from "@drive-coding/core"

/**
 * Translates spec.unsetEnv/setEnv into an SDK env-override object.
 *
 * - unsetEnv → key with value `undefined` (Node drops it on spawn ⇒ unset).
 * - setEnv   → key with string value (overrides process.env inside the SDK).
 * - Order: unsetEnv first, then setEnv — so setEnv wins on collision (same as spawn-core).
 * - Returns undefined if there is nothing to inject (spec empty / no env fields).
 */
export function buildClaudeEnvOverride(
  spec: CliSpec | undefined,
): Record<string, string | undefined> | undefined {
  if (spec === undefined) return undefined

  const hasUnset = (spec.unsetEnv?.length ?? 0) > 0
  const hasSet = spec.setEnv !== undefined && Object.keys(spec.setEnv).length > 0

  if (!hasUnset && !hasSet) return undefined

  const result: Record<string, string | undefined> = {}

  // unsetEnv first — value undefined signals Node to drop the key on spawn.
  if (spec.unsetEnv) {
    for (const key of spec.unsetEnv) {
      result[key] = undefined
    }
  }

  // setEnv after — overwrites any collision with a concrete string value.
  if (spec.setEnv) {
    for (const [key, value] of Object.entries(spec.setEnv)) {
      result[key] = value
    }
  }

  return result
}

/**
 * Merges envOverride into params._meta.claudeCode.options.env without overwriting
 * other fields (_meta, claudeCode, options, or env from a prior inject).
 *
 * - Returns params unchanged (same reference) if envOverride is undefined.
 * - Uses the same deep-spread pattern as injectModelOverride so both can compose:
 *     const withModel = injectModelOverride(ctx.params, opts.modelOverride)
 *     const params    = injectEnvOverride(withModel, envOverride)
 */
export function injectEnvOverride<T extends Record<string, unknown>>(
  params: T,
  envOverride: Record<string, string | undefined> | undefined,
): T {
  if (envOverride === undefined) return params

  const existingMeta = params["_meta"] as Record<string, unknown> | undefined
  const existingClaudeCode = existingMeta?.["claudeCode"] as Record<string, unknown> | undefined
  const existingOptions = existingClaudeCode?.["options"] as Record<string, unknown> | undefined

  return {
    ...params,
    _meta: {
      ...existingMeta,
      claudeCode: {
        ...existingClaudeCode,
        options: {
          ...existingOptions,
          env: envOverride,
        },
      },
    },
  } as T
}
