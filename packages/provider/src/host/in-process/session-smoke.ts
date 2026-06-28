/**
 * session-smoke.ts — live smoke test: start → newSession → prompt → print response.
 *
 * Usage:
 *   pnpm --filter @drive-coding/provider exec bun src/host/in-process/session-smoke.ts
 *
 * This script sends a real prompt to claude via the in-process host and prints
 * the streamed text response. The prompt is intentionally text-only (no tools)
 * to avoid permission requests (brief §4 Commit 1).
 *
 * Expected output:
 *   [smoke] starting host...
 *   [smoke] start complete. capabilities: { mcp: true, ... }
 *   [smoke] newSession complete. sessionId: <id>
 *   [smoke] prompting...
 *   [smoke] update #1: { sessionUpdate: "agent_message_chunk", ... }
 *   ...
 *   [smoke] prompt complete. stopReason: end_turn
 *   [smoke] collected text: "hello"
 *   [smoke] PASS — claude responded via in-process host
 */

import { createClaudeInProcessHost } from "./host.js"

const CWD = process.cwd()
const PROMPT = "Reply with exactly the word: hello"

async function main() {
  const host = createClaudeInProcessHost()

  console.log("[smoke] starting host...")
  const { capabilities } = await host.start({ cwd: CWD })
  console.log("[smoke] start complete. capabilities:", JSON.stringify(capabilities))

  console.log("[smoke] newSession...")
  const { sessionId } = await host.newSession({ cwd: CWD })
  console.log("[smoke] newSession complete. sessionId:", sessionId)

  const updates: Array<Record<string, unknown>> = []

  console.log("[smoke] prompting...")
  const { stopReason } = await host.prompt({ sessionId, text: PROMPT }, (update) => {
    updates.push(update)
    const n = updates.length
    // Print a brief summary of each update (not the full object to avoid noise)
    const kind = (update as { sessionUpdate?: string }).sessionUpdate ?? "unknown"
    console.log(`[smoke] update #${n}: sessionUpdate=${kind}`)
  })

  console.log(`[smoke] prompt complete. stopReason: ${stopReason}`)
  console.log(`[smoke] received ${updates.length} updates`)

  // Extract text from agent_message_chunk updates
  const textChunks = updates
    .filter(
      (u): u is Record<string, unknown> =>
        (u as { sessionUpdate?: string }).sessionUpdate === "agent_message_chunk",
    )
    .map((u) => {
      const content = (u as { content?: { text?: string } }).content
      return content?.text ?? ""
    })
    .filter((t) => t.length > 0)

  const collectedText = textChunks.join("").trim()
  console.log("[smoke] collected text:", JSON.stringify(collectedText))

  await host.close()
  console.log("[smoke] host closed.")

  if (collectedText.length > 0) {
    console.log("[smoke] PASS — claude responded via in-process host")
    process.exit(0)
  } else {
    console.error("[smoke] FAIL — no text collected from updates")
    console.error("[smoke] full updates:", JSON.stringify(updates.slice(0, 5), null, 2))
    process.exit(1)
  }
}

main().catch((err) => {
  console.error("[smoke] FATAL:", err)
  process.exit(1)
})
