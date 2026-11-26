import { appendDictation } from "$lib/engines/append-dictation"
import type { ImageAttachment } from "$lib/engines/image-attachment"
import { hasPromptContent, promptPayload } from "$lib/engines/prompt-payload"
import type { AgentSession } from "$lib/view-models/agent-session.svelte"
import type { Dictate } from "$lib/view-models/dictate.svelte"
import type { DictateSubmit } from "$lib/view-models/dictate-submit.svelte"
import type { PromptRetry } from "$lib/view-models/prompt-retry.svelte"

export async function runTypeAreaSubmit(opts: {
  session: Pick<AgentSession, "status" | "sendPrompt">
  dictate: Pick<Dictate, "state" | "finishListening" | "finishListeningForSubmit">
  prompts: PromptRetry
  dictateSubmit: DictateSubmit
  legacyFixture?: () => boolean
  draftText: () => string
  attachments: ImageAttachment[]
  clear: (expectedText: string, attachments: ImageAttachment[]) => void
}): Promise<void> {
  const { session, dictate, prompts, dictateSubmit, draftText, attachments, clear } = opts
  if (session.status !== "connected" || dictate.state === "busy") return
  const listening = dictate.state === "listening"
  const target = prompts.targets.current()
  if (!target) {
    if (!opts.legacyFixture?.()) return
    const result = listening ? await dictate.finishListening() : ({ ok: true, text: "" } as const)
    if (!result.ok || session.status !== "connected" || !opts.legacyFixture()) return
    const expected = draftText()
    const text = appendDictation(expected, result.text).trim()
    if (!text && !attachments.length) return
    void session.sendPrompt(text, { attachments })
    clear(expected, attachments)
    return
  }

  if (dictateSubmit.source || prompts.record) {
    prompts.report(target.ownerKey, "chat.prompt.resolvePrevious")
    return
  }

  const expected = draftText()
  const snapshot = promptPayload(expected, attachments)
  if (listening) {
    await dictate.finishListeningForSubmit(target, snapshot, {
      text: draftText,
      adopted: (text) => clear(text, attachments),
    })
    return
  }

  if (!hasPromptContent(snapshot)) return
  const adopted = await prompts.adopt(target, snapshot)
  if (adopted && prompts.targets.isCurrent(target)) clear(expected, attachments)
}

export function clearCapturedComposer(
  draft: { text: string; clear(): void },
  expectedText: string,
  sameRevision: boolean,
  clearAttachments: () => void,
) {
  if (sameRevision && draft.text === expectedText) draft.clear()
  clearAttachments()
}
