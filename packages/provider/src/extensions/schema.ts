/**
 * schema.ts — Unified extension methods registry (ArkType).
 *
 * Single source of truth for ext method contracts.
 * Adding a new ext method = one line here.
 *
 * n: number | null — null = no-limit (SDK setMaxThinkingTokens(null) is valid).
 */

import { type } from "arktype"

/** Unified registry of ext methods. Each entry: { params, result } ArkType schemas. */
export const extMethods = {
  "_drive/setThinkingTokens": {
    // n: number | null — null = cancel-limit (no-limit). SDK setMaxThinkingTokens accepts null.
    params: type({ sessionId: "string", n: "number | null" }),
    result: type({ ok: "true" }),
  },
  // Future: compact / setMcpServers / commands — add here
} as const

export type ExtMethodName = keyof typeof extMethods
