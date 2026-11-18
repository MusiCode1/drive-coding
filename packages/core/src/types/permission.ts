/**
 * permission.ts — shared permission types + pure helpers (no IO).
 *
 * Used by FE (view-model mapping) and BE (auto-resolve policy before pending).
 */
import type { Client } from "@agentclientprotocol/sdk"

/** Derived from SDK — zero drift. */
export type PermissionParams = Parameters<Client["requestPermission"]>[0]
export type PermissionResponse = Awaited<ReturnType<Client["requestPermission"]>>

export type PermissionOptionKind = "allow_once" | "allow_always" | "reject_once" | "reject_always"

/** POST /api/agents permissionPolicy — ACP option kinds only (not tool/mode names). */
export type PermissionPolicyKind = "allow_once" | "allow_always" | "reject_once" | "ask"

export type PermissionOptionView = {
  optionId: string
  name: string
  kind: PermissionOptionKind
}

/** Sort: allow before reject; within each group, once before always. */
const KIND_ORDER: Record<PermissionOptionKind, number> = {
  allow_once: 0,
  allow_always: 1,
  reject_once: 2,
  reject_always: 3,
}

/** Map SDK options to sorted button list for UI. */
export function mapPermissionOptions(params: PermissionParams): PermissionOptionView[] {
  return params.options
    .map((o) => ({ optionId: o.optionId, name: o.name, kind: o.kind as PermissionOptionKind }))
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
}

/** Default highlight: allow_once if present; else first after sort. Empty → undefined. */
export function defaultPermissionOptionId(
  options: readonly PermissionOptionView[],
): string | undefined {
  return options.find((o) => o.kind === "allow_once")?.optionId ?? options[0]?.optionId
}

/**
 * Resolve a permission policy against the options the agent offered.
 *
 * Returns a PermissionResponse when the policy auto-selects; null means fall
 * through to pending (human prompt) — including `"ask"`, missing policy, empty
 * options, or a requested kind not present in `options`.
 */
export function resolvePermissionPolicy(
  policy: PermissionPolicyKind | undefined,
  params: Pick<PermissionParams, "options">,
): PermissionResponse | null {
  if (policy === undefined || policy === "ask") return null
  if (params.options.length === 0) return null
  const match = params.options.find((o) => o.kind === policy)
  if (!match) return null
  return { outcome: { outcome: "selected", optionId: match.optionId } }
}
