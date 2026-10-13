/**
 * scope-policy-api.ts — GET/PATCH /api/scope-policy (C3).
 */

import {
  type ScopeAction,
  type ScopePolicy,
  ScopePolicyPatchBodySchema,
  type ScopePolicySnapshot,
  ScopePolicySnapshotSchema,
} from "@drive-coding/core/schemas/scope-policy"
import { type } from "arktype"
import { beUrl } from "$lib/util/be-url"

export type ScopePolicyPatchInput = {
  policies: Partial<Record<ScopeAction, ScopePolicy>>
}

export async function fetchScopePolicy(signal?: AbortSignal): Promise<ScopePolicySnapshot> {
  const res = await fetch(beUrl("/api/scope-policy"), {
    signal,
    headers: { Accept: "application/json" },
  })
  if (!res.ok) {
    throw new Error(`fetchScopePolicy failed: ${res.status}`)
  }
  const raw: unknown = await res.json()
  const parsed = ScopePolicySnapshotSchema(raw)
  if (parsed instanceof type.errors) {
    throw new Error(`fetchScopePolicy invalid response: ${parsed.summary}`)
  }
  return parsed
}

export async function patchScopePolicy(
  patch: ScopePolicyPatchInput,
  signal?: AbortSignal,
): Promise<ScopePolicySnapshot> {
  const body = ScopePolicyPatchBodySchema({ policies: patch.policies })
  if (body instanceof type.errors) {
    throw new Error(`patchScopePolicy invalid input: ${body.summary}`)
  }
  const res = await fetch(beUrl("/api/scope-policy"), {
    method: "PATCH",
    signal,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`patchScopePolicy failed: ${res.status}`)
  }
  const raw: unknown = await res.json()
  const parsed = ScopePolicySnapshotSchema(raw)
  if (parsed instanceof type.errors) {
    throw new Error(`patchScopePolicy invalid response: ${parsed.summary}`)
  }
  return parsed
}
