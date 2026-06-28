/**
 * rename.ts — wrapper around renameSession() from @anthropic-ai/claude-agent-sdk.
 *
 * Two-SDK containment: this file imports from the SDK but only exposes
 * (string, string, string | undefined) → Promise<void>. No SDK types leak.
 *
 * Strategy (brief §3 §9):
 * - Try { dir: cwd } first (faster — scoped to the project directory).
 * - On error: retry without dir (searches all projects).
 * - If both fail: throw the original error.
 */

import { renameSession } from "@anthropic-ai/claude-agent-sdk"

/**
 * Renames a claude session by sessionId.
 *
 * @param sessionId - UUID of the session to rename
 * @param title - New title to set
 * @param cwd - Optional project directory path (same semantics as renameSession({ dir })).
 *              When provided, tried first as a scoped lookup; falls back to search-all on error.
 */
export async function claudeRenameSession(
  sessionId: string,
  title: string,
  cwd: string | undefined,
): Promise<void> {
  if (cwd !== undefined) {
    try {
      await renameSession(sessionId, title, { dir: cwd })
      return
    } catch {
      // dir-scoped lookup failed — fall through to search-all
    }
  }
  // Search all projects (omit dir)
  await renameSession(sessionId, title)
}
