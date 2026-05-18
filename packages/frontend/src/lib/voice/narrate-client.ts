/**
 * narrate-client.ts — generate Hebrew narration for tool calls.
 *
 * Uses buildNarratePrompt from core (ported from BE narration.ts).
 * Timeout 1500ms. Fallback to tool.title on error/timeout.
 */

import { buildNarratePrompt } from "@drive-coding/core/voice/narration-prompt"
import { generateText } from "ai"
import { googleAi } from "./sdks"

const TIMEOUT_MS = 1500

export interface NarrateOpts {
  userMessage: string
  recentMessages: string[]
  tool: {
    toolCallId: string
    title: string
    kind?: string
  }
  signal?: AbortSignal
}

export async function narrate(opts: NarrateOpts): Promise<string> {
  const prompt = buildNarratePrompt(
    { userMessage: opts.userMessage, recentMessages: opts.recentMessages },
    { toolCallId: opts.tool.toolCallId, title: opts.tool.title, kind: opts.tool.kind },
  )

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)
  opts.signal?.addEventListener("abort", () => ac.abort(), { once: true })

  try {
    const result = await generateText({
      model: googleAi("gemini-flash-lite-latest"),
      prompt,
      abortSignal: ac.signal,
    })
    return result.text.trim() || opts.tool.title // fallback to title if empty
  } catch (_e) {
    return opts.tool.title // fallback on error or timeout
  } finally {
    clearTimeout(timer)
  }
}
