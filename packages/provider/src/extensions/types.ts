/**
 * types.ts — Derived types + runtime validation for ext methods.
 *
 * ExtParams<M> / ExtResult<M> — inferred from ArkType schemas (no duplication).
 * parseExtParams — validates at the host boundary; throws on invalid input.
 */

import { type } from "arktype"
import { extMethods } from "./schema.js"
import type { ExtMethodName } from "./schema.js"

export type { ExtMethodName } from "./schema.js"

/** Infer the params type for a given ext method. */
export type ExtParams<M extends ExtMethodName> = (typeof extMethods)[M]["params"]["infer"]

/** Infer the result type for a given ext method. */
export type ExtResult<M extends ExtMethodName> = (typeof extMethods)[M]["result"]["infer"]

/**
 * Validates raw params against the registered schema for the given method.
 * Returns the typed params on success; throws a descriptive error on failure.
 *
 * Used at the host boundary — prevents invalid input from reaching the query.
 */
export function parseExtParams<M extends ExtMethodName>(method: M, raw: unknown): ExtParams<M> {
  const schema = extMethods[method].params
  const out = schema(raw)
  if (out instanceof type.errors) {
    throw new Error(`Invalid params for ${method}: ${out.summary}`)
  }
  return out as ExtParams<M>
}
