/**
 * translate-client.ts — translate text via Gemini Flash Lite (through BE proxy).
 *
 * Uses generateObject with a discriminated-union JSON schema so Gemini can
 * signal "already in target language" with a minimal payload, avoiding both
 * unnecessary paraphrasing and wasted output tokens.
 *
 * Caching: results are stored in localStorage keyed by sha256(text|targetLang)
 * so reload doesn't re-pay for the same translation.
 *
 * Timeout 2500ms with AbortController. Returns null on abort/timeout/error
 * (orchestrator treats null as skip).
 *
 * Model: gemini-flash-lite-latest. We're keeping Flash Lite intentionally for
 * now and will switch to Flash if structured-output reliability is poor in
 * practice (see chat 2026-05-18 with Avi).
 */

import { buildTranslationPrompt } from "@drive-coding/core/voice/translation-prompt"
import { generateObject, jsonSchema } from "ai"
import { createLogger } from "$lib/log"
import { googleAi } from "./sdks"
import { getCached, setCached, type TranslateResult } from "./translate-cache"

const log = createLogger("fe.translate")

const TIMEOUT_MS = 2500

/**
 * JSON schema enforced by Gemini's responseSchema. anyOf gives us a true
 * discriminated union — when the source is already Hebrew, Gemini emits
 * `{"status":"already_in_target"}` (~6 tokens) instead of repeating the
 * original text.
 *
 * The TypeScript generic gives generateObject the right return type so the
 * caller can switch on `result.object.status` with full inference.
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
 *
 * Side effect: persists successful results to localStorage (see translate-cache.ts).
 */
export async function translate(
  text: string,
  targetLang: "he" | "en",
  signal?: AbortSignal,
): Promise<TranslateResult | null> {
  // 1. Cache lookup — short-circuits before any network call.
  const cached = await getCached(text, targetLang).catch(() => null)
  if (cached) {
    log.debug(
      { cache: "hit", status: cached.status, len: text.length },
      "translate served from cache",
    )
    return cached
  }

  // 2. Build prompt — reuses the core's prompt that already includes the
  //    "if already in target, return as-is" instruction. We *also* enforce
  //    that via the schema, so the prompt + schema are belt-and-suspenders.
  const basePrompt = buildTranslationPrompt(text, targetLang)
  const prompt = `${basePrompt}

Respond as JSON matching the schema:
- If the source is already in the target language, return {"status":"already_in_target"} (omit any text field).
- Otherwise, return {"status":"translated","text":"<the translated text>"}.`

  // 3. Race against timeout.
  const ac = new AbortController()
  const timer = setTimeout(
    () => ac.abort(new Error(`Translate timeout ${TIMEOUT_MS}ms`)),
    TIMEOUT_MS,
  )
  signal?.addEventListener("abort", () => ac.abort(), { once: true })

  try {
    const t0 = performance.now()
    const result = await generateObject({
      model: googleAi("gemini-flash-lite-latest"),
      schema: translateSchema,
      prompt,
      abortSignal: ac.signal,
    })
    const obj = result.object
    log.debug(
      { dur: performance.now() - t0, status: obj.status, len: text.length },
      "translate done",
    )

    // 4. Cache successful result. Empty translated text is treated as failure
    //    to avoid poisoning the cache with garbage on a rare malformed model
    //    response.
    if (obj.status === "translated" && obj.text.trim().length === 0) {
      log.warn({ len: text.length }, "translate returned empty text — treating as failure")
      return null
    }
    // Await the cache write — sha256 is fast (~1ms) and we want subsequent
    // calls (including in tests) to see the entry deterministically.
    await setCached(text, targetLang, obj).catch(() => {
      /* logged inside setCached */
    })
    return obj
  } catch (e) {
    // Aborted, timed out, or API error — orchestrator skips this segment.
    log.warn(
      { err: e instanceof Error ? e.message : String(e), len: text.length },
      "translate failed",
    )
    return null
  } finally {
    clearTimeout(timer)
  }
}
