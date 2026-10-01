import type { AvailableCommand, UsageUpdate } from "@agentclientprotocol/sdk"
import type { PlanStore } from "@drive-coding/core/acp/plan"
import type { QuotaSnapshot } from "@drive-coding/provider/extensions"
import type { SessionInfo } from "$lib/adapters/sessions"

export interface PatchOwner<P extends { readonly kind: string }> {
  applyPatch(patch: P): void
}

export type SessionPatch =
  | { readonly kind: "commands"; readonly commands: AvailableCommand[] }
  | { readonly kind: "plan"; readonly plan: PlanStore }
  | { readonly kind: "usage"; readonly usage: UsageUpdate | null }
  | { readonly kind: "title"; readonly title: string }
  | { readonly kind: "quota"; readonly quota: QuotaSnapshot | null }
  | { readonly kind: "quota-loading"; readonly loading: boolean }

export type SessionsCachePatch =
  | { readonly kind: "list"; readonly sessions: SessionInfo[] }
  | { readonly kind: "remove"; readonly sessionId: string }
  | { readonly kind: "reset" }
  | { readonly kind: "loading"; readonly loading: boolean }
  | { readonly kind: "error"; readonly error: string | null }
