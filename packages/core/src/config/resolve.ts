/**
 * resolve.ts — pure config resolution (no IO).
 *
 * Takes an ordered array of config layers from lowest to highest priority:
 *   [fileLayer, envLayer, flagLayer]
 *
 * Merge rules:
 *   - Scalar/array fields: highest layer that defines the field wins.
 *   - Object fields (log, voice, https-as-object): wholesale override —
 *     the entire object from the highest layer that defines it wins (no deep merge).
 *   - cliSpecs: per-key merge — each CLI kind is resolved independently
 *     across layers (allows partial overrides per CLI).
 *
 * Returns Result<DriveCodingConfig, string[]> (neverthrow).
 * Validation errors accumulate before returning Err.
 */

import { type } from "arktype"
import { err, ok } from "neverthrow"
import type { Result } from "neverthrow"
import { DriveCodingConfig } from "./schema.js"

export function resolveConfig(
  layers: ReadonlyArray<Partial<DriveCodingConfig>>,
): Result<DriveCodingConfig, string[]> {
  // Build merged config object — iterate layers from lowest to highest priority.
  // Higher-index layers override lower-index layers.

  const merged: Record<string, unknown> = {}

  // Fields that are objects and should be overridden wholesale (not deep-merged).
  const wholesaleObjectFields = new Set(["log", "voice", "https"])

  // cliSpecs is merged per-key.
  let cliSpecsMerged: Record<string, unknown> | undefined

  for (const layer of layers) {
    if (!layer || typeof layer !== "object") continue

    for (const [key, value] of Object.entries(layer)) {
      if (value === undefined) continue

      if (key === "cliSpecs") {
        // Per-key merge: higher layer keys override lower layer keys.
        const incoming = value as Record<string, unknown>
        if (cliSpecsMerged === undefined) {
          cliSpecsMerged = { ...incoming }
        } else {
          // Merge: higher layer (current iteration) wins per key.
          Object.assign(cliSpecsMerged, incoming)
        }
      } else if (wholesaleObjectFields.has(key)) {
        // Wholesale: later layer replaces entirely.
        merged[key] = value
      } else {
        // Scalar / array: later layer wins.
        merged[key] = value
      }
    }
  }

  if (cliSpecsMerged !== undefined) {
    merged["cliSpecs"] = cliSpecsMerged
  }

  // Validate with ArkType.
  const validated = DriveCodingConfig(merged)
  if (validated instanceof type.errors) {
    const messages = validated.map((e) => e.message)
    return err(messages)
  }

  return ok(validated as DriveCodingConfig)
}
