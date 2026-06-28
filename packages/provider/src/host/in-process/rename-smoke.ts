/**
 * rename-smoke.ts — live smoke test: start → newSession → rename → verify name changed.
 *
 * Usage:
 *   pnpm --filter @drive-coding/provider exec bun src/host/in-process/rename-smoke.ts
 *
 * DoD 2 of slice-C3-rename: proves that host.rename(sessionId, "DC-TEST") actually
 * changes the session title as visible via listSessions / session_info_update.
 *
 * Verification: listSessions() from @anthropic-ai/claude-agent-sdk — same SDK
 * that manages the store. If renameSession() updated the store, the new title
 * will appear in the returned session list.
 *
 * Escalation point (brief §7): if the title does NOT appear in listSessions after
 * rename, print ESCALATE and exit 2 (not a failure of the code, but of the approach).
 */

import { listSessions } from "@anthropic-ai/claude-agent-sdk"
import { resolve } from "node:path"
import { createClaudeInProcessHost } from "./host.js"

// Use absolute path so listSessions({ dir }) can map it to the correct store directory.
const CWD = resolve(process.cwd())
const RENAME_TITLE = "DC-TEST"
// Short prompt to force claude to create the session JSONL file before rename.
// renameSession() appends to the JSONL — the file must exist first.
const INIT_PROMPT = "Reply with exactly the word: hello"

async function main() {
  const host = createClaudeInProcessHost()

  console.log("[rename-smoke] starting host...")
  const { capabilities } = await host.start({ cwd: CWD })
  console.log("[rename-smoke] start complete. capabilities:", JSON.stringify(capabilities))

  if (!capabilities.rename) {
    console.error("[rename-smoke] FAIL — capabilities.rename is false")
    process.exit(1)
  }
  console.log("[rename-smoke] capabilities.rename=true OK")

  console.log("[rename-smoke] newSession...")
  const { sessionId } = await host.newSession({ cwd: CWD })
  console.log("[rename-smoke] newSession complete. sessionId:", sessionId)

  // Send a short prompt first — claude writes the JSONL file during a turn.
  // renameSession() appends to the JSONL; without a prior turn the file does not exist.
  console.log("[rename-smoke] sending init prompt (creates JSONL)...")
  const { stopReason } = await host.prompt({ sessionId, text: INIT_PROMPT }, (u) => {
    const kind = (u as { sessionUpdate?: string }).sessionUpdate ?? "unknown"
    if (kind === "agent_message_chunk") process.stdout.write(".")
  })
  console.log(`\n[rename-smoke] prompt done. stopReason=${stopReason}`)

  console.log(`[rename-smoke] renaming to "${RENAME_TITLE}"...`)
  await host.rename(sessionId, RENAME_TITLE)
  console.log("[rename-smoke] rename() returned (no error)")

  // Verify: listSessions should show the new title
  // listSessions returns SDKSessionInfo with sessionId (not id) and customTitle (not title)
  console.log("[rename-smoke] verifying via listSessions({ dir: CWD })...")
  let sessions = await listSessions({ dir: CWD })
  let found = sessions.find((s) => s.sessionId === sessionId)

  if (!found) {
    // Fallback: search all (omit dir)
    console.log("[rename-smoke] session not found with dir, trying search-all...")
    sessions = await listSessions()
    found = sessions.find((s) => s.sessionId === sessionId)
  }

  await host.close()
  console.log("[rename-smoke] host closed.")

  if (!found) {
    console.error("[rename-smoke] FAIL — session not found in listSessions at all")
    console.error("[rename-smoke] sessionId:", sessionId)
    process.exit(1)
  }

  console.log(
    "[rename-smoke] session found:",
    JSON.stringify({ sessionId: found.sessionId, customTitle: found.customTitle, summary: found.summary }),
  )

  // renameSession() appends a custom-title record; listSessions reflects it as customTitle
  const effectiveTitle = found.customTitle ?? found.summary
  if (effectiveTitle === RENAME_TITLE) {
    console.log(`[rename-smoke] PASS — title is "${effectiveTitle}" as expected`)
    process.exit(0)
  } else {
    // This is the escalation point from brief §7
    console.error(
      `[rename-smoke] ESCALATE — title is "${effectiveTitle}" (expected "${RENAME_TITLE}")`,
    )
    console.error(
      "[rename-smoke] renameSession() updated the store but title not reflected in listSessions.",
    )
    console.error("[rename-smoke] This may indicate a live-query path issue (brief §7 escalation).")
    process.exit(2)
  }
}

main().catch((err) => {
  console.error("[rename-smoke] FATAL:", err)
  process.exit(1)
})
