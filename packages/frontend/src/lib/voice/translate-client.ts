/**
 * translate-client.ts — translate text via Gemini (through BE proxy).
 *
 * Uses @ai-sdk/google generateText for text-only translation.
 * Timeout 2500ms with internal AbortController.
 * Returns null on abort/timeout/error (orchestrator treats null as skip).
 */

import { generateText } from "ai"
import { googleAi } from "./sdks"

const TIMEOUT_MS = 2500

export async function translate(
  text: string,
  targetLang: "he" | "en",
  signal?: AbortSignal,
): Promise<string | null> {
  const targetName = targetLang === "he" ? "Hebrew" : "English"
  const prompt = `Translate the following text to ${targetName}.
Output ONLY the translated text, no explanations.

Text:
${text}`

  const ac = new AbortController()
  const timer = setTimeout(
    () => ac.abort(new Error(`Translate timeout ${TIMEOUT_MS}ms`)),
    TIMEOUT_MS,
  )
  signal?.addEventListener("abort", () => ac.abort(), { once: true })

  try {
    const result = await generateText({
      model: googleAi("gemini-flash-lite-latest"),
      prompt,
      abortSignal: ac.signal,
    })
    return result.text.trim() || null
  } catch (_e) {
    return null // aborted, timed out, or API error — orchestrator skips this segment
  } finally {
    clearTimeout(timer)
  }
}
