/**
 * resolve.ts — pure config resolution (no IO).
 *
 * Takes an ordered array of config layers from lowest to highest priority:
 *   [fileLayer, envLayer, flagLayer]
 *
 * Merge rules:
 *   - CONFIG_SPECS leaves (port, host, log.*, …): highest layer that defines
 *     each leaf wins — partial objects do not erase sibling leaves.
 *   - cliSpecs: per-key merge — each CLI kind is resolved independently
 *     across layers (allows partial overrides per CLI).
 *   - Other keys (https): wholesale override — entire value from the highest
 *     layer that defines the key wins.
 *
 * Returns Result<DriveCodingConfig, string[]> (neverthrow).
 * Validation errors accumulate before returning Err.
 */

import { type } from "arktype"
import type { Result } from "neverthrow"
import { err, ok } from "neverthrow"
import { DriveCodingConfig } from "./schema.js"
import { CONFIG_SPECS, type ConfigLeafKey, getLeaf, setLeaf } from "./specs.js"

const WHOLESALE_KEYS = new Set(["cliSpecs", "https"])

export function resolveConfig(
  layers: ReadonlyArray<Partial<DriveCodingConfig>>,
): Result<DriveCodingConfig, string[]> {
  const leafValues = new Map<ConfigLeafKey, unknown>()
  let cliSpecsMerged: Record<string, unknown> | undefined
  const wholesaleValues: Record<string, unknown> = {}

  for (const layer of layers) {
    if (!layer || typeof layer !== "object") continue

    for (const spec of CONFIG_SPECS) {
      const value = getLeaf(layer, spec.key)
      if (value !== undefined) {
        leafValues.set(spec.key, value)
      }
    }

    for (const [key, value] of Object.entries(layer)) {
      if (value === undefined) continue

      if (key === "cliSpecs") {
        const incoming = value as Record<string, unknown>
        if (cliSpecsMerged === undefined) {
          cliSpecsMerged = { ...incoming }
        } else {
          Object.assign(cliSpecsMerged, incoming)
        }
      } else if (WHOLESALE_KEYS.has(key)) {
        wholesaleValues[key] = value
      }
    }
  }

  const merged: Record<string, unknown> = { ...wholesaleValues }
  for (const [key, value] of leafValues) {
    setLeaf(merged, key, value)
  }
  if (cliSpecsMerged !== undefined) {
    merged["cliSpecs"] = cliSpecsMerged
  }

  const validated = DriveCodingConfig(merged)
  if (validated instanceof type.errors) {
    const messages = validated.map((e) => e.message)
    return err(messages)
  }

  return ok(validated as DriveCodingConfig)
}
