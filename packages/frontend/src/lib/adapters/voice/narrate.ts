/**
 * narrate.ts — generate a short Hebrew prose sentence describing a tool call.
 *
 * Uses generateText (plain string, not JSON) via @ai-sdk/google → BE proxy.
 * The prompt is built by buildNarratePrompt from @drive-coding/core (already exists).
 * The BE proxy-cache captures the generateContent call — same prompt on reload → hit.
 *
 * Timeout 3000ms. Returns null on timeout/error/abort (UI shows loading state).
 * Model: gemini-flash-lite-latest (cheap, fast, Hebrew-capable).
 */

import { generateText } from "ai"
import { googleAi } from "./sdks"
import {
  buildNarratePrompt,
  type NarrateContext,
  type ToolCallForNarrate,
} from "@drive-coding/core/voice/narration-prompt"

const TIMEOUT_MS = 3000

/**
 * Generate a Hebrew narration for a tool call.
 * Returns the Hebrew sentence, or null on any error.
 */
export async function narrate(
  ctx: NarrateContext,
  tool: ToolCallForNarrate,
  signal?: AbortSignal,
): Promise<string | null> {
  const prompt = buildNarratePrompt(ctx, tool)
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(new Error(`narrate timeout ${TIMEOUT_MS}ms`)), TIMEOUT_MS)
  signal?.addEventListener("abort", () => ac.abort(), { once: true })
  try {
    const result = await generateText({
      model: googleAi("gemini-flash-lite-latest"),
      prompt,
      abortSignal: ac.signal,
    })
    const text = result.text.trim()
    if (text.length === 0) return null
    return text
  } catch (e) {
    console.warn("narrate failed", {
      err: e instanceof Error ? e.message : String(e),
    })
    return null
  } finally {
    clearTimeout(timer)
  }
}
