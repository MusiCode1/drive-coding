/**
 * translate.ts — translate text via Gemini Flash Lite (through BE proxy).
 *
 * Uses generateObject with a discriminated-union JSON schema so Gemini can
 * signal "already in target language" with a minimal payload, avoiding both
 * unnecessary paraphrasing and wasted output tokens.
 *
 * Slice 2: no FE localStorage cache — the BE proxy already caches
 * `generateContent` (see packages/backend/src/delivery/proxy-cache.ts). If we
 * later need offline support we can re-introduce a thin localStorage layer.
 *
 * Timeout 2500ms with AbortController. Returns null on abort/timeout/error
 * (caller treats null as "skip translation, use original text").
 *
 * Model: gemini-flash-lite-latest. Cheap, fast, deterministic enough for
 * short prose. learnings 2026-05-16: gemini-2.0-flash family is deprecated to
 * new users — must use `*-latest` aliases.
 */

import { buildTranslationPrompt } from "@drive-coding/core/voice/translation-prompt"
import { generateObject, jsonSchema } from "ai"
import { googleAi } from "./sdks"

const TIMEOUT_MS = 2500

export type TranslateResult =
  | { status: "already_in_target" }
  | { status: "translated"; text: string }

/**
 * JSON schema enforced by Gemini's responseSchema. anyOf gives us a true
 * discriminated union — when the source is already Hebrew, Gemini emits
 * `{"status":"already_in_target"}` (~6 tokens) instead of repeating the
 * original text.
 */
const translateSchema = jsonSchema<TranslateResult>({
  anyOf: [
    {
      type: "object",
      properties: {
        status: { type: "string", enum: ["already_in_target"] },
      },
      required: ["status"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        status: { type: "string", enum: ["translated"] },
        text: { type: "string" },
      },
      required: ["status", "text"],
      additionalProperties: false,
    },
  ],
})

/**
 * Translate `text` to `targetLang`. Returns:
 *   - { status: "translated", text } when Gemini produced a translation
 *   - { status: "already_in_target" } when the source was already in target lang
 *   - null on abort, timeout, or any error
 */
export async function translate(
  text: string,
  targetLang: "he" | "en",
  signal?: AbortSignal,
): Promise<TranslateResult | null> {
  const basePrompt = buildTranslationPrompt(text, targetLang)
  const prompt = `${basePrompt}

Respond as JSON matching the schema:
- If the source is already in the target language, return {"status":"already_in_target"} (omit any text field).
- Otherwise, return {"status":"translated","text":"<the translated text>"}.`

  const ac = new AbortController()
  const timer = setTimeout(
    () => ac.abort(new Error(`Translate timeout ${TIMEOUT_MS}ms`)),
    TIMEOUT_MS,
  )
  signal?.addEventListener("abort", () => ac.abort(), { once: true })

  try {
    const result = await generateObject({
      model: googleAi("gemini-flash-lite-latest"),
      schema: translateSchema,
      prompt,
      abortSignal: ac.signal,
    })
    const obj = result.object

    // Treat empty translated text as failure to avoid downstream TTS-of-emptiness.
    if (obj.status === "translated" && obj.text.trim().length === 0) {
      console.warn("translate returned empty text — treating as failure", { len: text.length })
      return null
    }
    return obj
  } catch (e) {
    console.warn("translate failed", {
      err: e instanceof Error ? e.message : String(e),
      len: text.length,
    })
    return null
  } finally {
    clearTimeout(timer)
  }
}
