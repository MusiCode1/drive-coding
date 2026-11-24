import {
  conversationHasLiveAgentPreamble,
  formatSecretaryDispatch,
} from "@drive-coding/core/voice/live-agent-prompt"
import { canDispatchPrompt } from "@drive-coding/core/voice/live-dispatch"
import { isUnpromptedSend } from "@drive-coding/core/voice/unprompted-guard"
import type { AgentSession } from "./agent-session.svelte"

type DispatchSession = Pick<
  AgentSession,
  "status" | "sessionId" | "lastUserMessage" | "bubbles" | "sendPrompt"
>

function conversationTexts(session: DispatchSession): string[] {
  const texts: string[] = []
  if (session.lastUserMessage) texts.push(session.lastUserMessage)
  for (const bubble of session.bubbles ?? []) {
    if (bubble.kind === "user") texts.push(bubble.segments.map((segment) => segment.text).join(""))
  }
  return texts
}

export function dispatchLiveAgentPrompt(
  session: DispatchSession,
  text: string,
  deliveredSinceUserSpoke: boolean,
) {
  if (isUnpromptedSend({ deliveredSinceUserSpoke })) {
    return { status: "not_sent", reason: "unprompted" }
  }
  const verdict = canDispatchPrompt({
    status: session.status,
    hasSessionId: session.sessionId !== null,
    text,
  })
  if (!verdict.ok) return { status: "not_sent", reason: verdict.reason }

  const includePreamble = !conversationHasLiveAgentPreamble(conversationTexts(session))
  void session.sendPrompt(formatSecretaryDispatch(text, { includePreamble }))
  return { status: "sent" }
}
