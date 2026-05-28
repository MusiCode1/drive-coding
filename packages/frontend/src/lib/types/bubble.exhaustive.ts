/**
 * bubble.exhaustive.ts — compile-time exhaustiveness check for the Bubble union.
 *
 * Companion to `BubbleRenderer.svelte` (the switch dispatcher for bubble
 * variants). If a future slice adds a new variant to `Bubble` (e.g.
 * `SystemBubble`) but forgets to update `BubbleRenderer.svelte`, the runtime
 * switch will silently no-op for the new kind — a quiet regression.
 *
 * This file forces TypeScript to flag that omission at typecheck time:
 *
 *   1. `kindCheck` enumerates every kind via a `switch (b.kind)` and assigns
 *      the post-switch `b` to `never`. If a new variant is added without a
 *      matching `case`, `b` will be the missing variant (not `never`) and
 *      the assignment will fail.
 *
 *   2. `kindLiteral` is the union of all `Bubble["kind"]` literals as it
 *      currently exists; the local `KnownKind` next to it enumerates the
 *      kinds we *expect* to handle. The `Equals` helper requires the two to
 *      be identical, forcing this file to be updated alongside the union.
 *
 * Limitation: this guarantees `Bubble` is a closed union and that every
 * kind is enumerated *here*. It does NOT directly verify that
 * `BubbleRenderer.svelte` handles every kind — Svelte's `svelte-check`
 * already does that for the `{:else if bubble.kind === "X"}` chain. The
 * combination of the two means any new variant must touch both files.
 *
 * NOT executed at runtime. Pure type-level guard. Imported nowhere.
 */

import type { Bubble } from "./bubble"

// ─── 1. Switch exhaustiveness on bubble.kind ──────────────────────────────────

function kindCheck(b: Bubble): string {
  switch (b.kind) {
    case "user":
      return "user"
    case "message":
      return "message"
    case "thought":
      return "thought"
    case "tool":
      return "tool"
    default: {
      // If a new variant is added to `Bubble`, `b` here will be that variant
      // (not `never`), and this assignment will fail typecheck.
      const _exhaustive: never = b
      return _exhaustive
    }
  }
}
void kindCheck

// ─── 2. Literal-union equality with the explicit list of kinds ────────────────

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false

/** Every kind we currently know how to render. Adding a variant to `Bubble`
 *  requires adding it here too — otherwise `_kindsMatch` flips to `false`
 *  and the `: true` annotation rejects it. */
type KnownKind = "user" | "message" | "thought" | "tool"

// If this line errors with "Type 'false' is not assignable to type 'true'",
// a new bubble kind was added without updating this file (and very likely
// without updating BubbleRenderer.svelte either).
const _kindsMatch: Equals<Bubble["kind"], KnownKind> = true
void _kindsMatch
