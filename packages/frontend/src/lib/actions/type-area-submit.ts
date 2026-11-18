/**
 * type-area-submit.ts — submit orchestration for TypeArea (slice dictate-to-input-polish, C1).
 */

import { appendDictation } from "$lib/engines/append-dictation"
import type { ImageAttachment } from "$lib/engines/image-attachment"
import type { AgentSession } from "$lib/view-models/agent-session.svelte"
import type { DictateState, FinishListeningResult } from "$lib/view-models/dictate.svelte"

export async function runTypeAreaSubmit(opts: {
  isDisabled: boolean
  dictateState: DictateState
  finishListening: () => Promise<FinishListeningResult>
  draftText: () => string
  attachments: ImageAttachment[]
  sendPrompt: (text: string, opts: { attachments: ImageAttachment[] }) => void
  sessionStatus: () => AgentSession["status"]
  clear: () => void
}): Promise<void> {
  if (opts.isDisabled) return
  if (opts.dictateState === "busy") return

  if (opts.dictateState === "listening") {
    const result = await opts.finishListening()
    if (!result.ok) return
    if (opts.sessionStatus() !== "connected") return
    const body = appendDictation(opts.draftText().trim(), result.text).trim()
    if (!body && opts.attachments.length === 0) return
    opts.sendPrompt(body, { attachments: opts.attachments })
    opts.clear()
    return
  }

  const text = opts.draftText().trim()
  if (!text && opts.attachments.length === 0) return
  opts.sendPrompt(text, { attachments: opts.attachments })
  opts.clear()
}
