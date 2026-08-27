/**
 * unprompted-guard.ts — mechanical loop guard (causality, not text).
 *
 * Slice: live-unprompted-guard, Commit 0.
 *
 * Does not read prompt text. Rephrasing via compose_prompt is irrelevant —
 * that is what distinguishes this layer from the delivery marker.
 */

export function isUnpromptedSend(input: { deliveredSinceUserSpoke: boolean }): boolean {
  return input.deliveredSinceUserSpoke
}
