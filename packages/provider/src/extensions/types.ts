/**
 * types.ts — Derived types + runtime validation for ext methods.
 *
 * ExtParams<M> / ExtResult<M> — inferred from ArkType schemas (no duplication).
 * parseExtParams — validates at the host boundary; throws on invalid input.
 */

import { type } from "arktype"
import { extMethods, QuotaConsumption, QuotaPeriod, QuotaSnapshot, QuotaWindow } from "./schema.js"
import type { ExtMethodName } from "./schema.js"

export type { ExtMethodName } from "./schema.js"

/** Infer the params type for a given ext method. */
export type ExtParams<M extends ExtMethodName> = (typeof extMethods)[M]["params"]["infer"]

/** Infer the result type for a given ext method. */
export type ExtResult<M extends ExtMethodName> = (typeof extMethods)[M]["result"]["infer"]

// ─── quota (session-budget-meter) — types derived from schema.ts, no duplication ───
export type QuotaPeriod = typeof QuotaPeriod.infer
export type QuotaConsumption = typeof QuotaConsumption.infer
export type QuotaWindow = typeof QuotaWindow.infer
export type QuotaSnapshot = typeof QuotaSnapshot.infer
export type GetQuotaResult = ExtResult<"_drive/getQuota">

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

/**
 * Validates a raw ext result (transport-decoded object) against the registered
 * result schema for the given method. Returns the typed result on success;
 * throws a descriptive error on failure.
 *
 * Used at the client (FE facade) boundary — prevents a malformed provider
 * response from reaching the UI unvalidated.
 */
export function parseExtResult<M extends ExtMethodName>(method: M, raw: unknown): ExtResult<M> {
  const schema = extMethods[method].result
  const out = schema(raw)
  if (out instanceof type.errors) {
    throw new Error(`Invalid result for ${method}: ${out.summary}`)
  }
  return out as ExtResult<M>
}
