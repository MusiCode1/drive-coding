import { buildPrompt, hasPromptContent, promptPayload } from "$lib/engines/prompt-payload"
import type { SessionView } from "$lib/session/session-view"
import type { AgentSession, TurnState } from "./agent-session.svelte"
import { formatAcpError } from "./format-acp-error"

export type LegacyPromptOptions = {
  recordingId?: string
  attachments?: { mimeType: string; dataBase64: string }[]
}

export async function sendLegacyPrompt(
  session: Pick<AgentSession, "status" | "lastUserMessage" | "error">,
  view: SessionView | null,
  setTurnState: (state: TurnState) => void,
  text: string,
  opts?: LegacyPromptOptions,
): Promise<void> {
  if (session.status !== "connected" || !view) return
  const payload = promptPayload(text, opts?.attachments, opts?.recordingId)
  if (!hasPromptContent(payload)) return

  session.lastUserMessage = text
  const { content, meta } = buildPrompt(payload)
  setTurnState("waiting")
  try {
    await view.prompt(content, meta)
  } catch (err) {
    setTurnState("idle")
    session.error = `prompt failed: ${formatAcpError(err)}`
  }
}
