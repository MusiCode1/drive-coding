/**
 * sdks.ts — SDK factories configured for our BE proxy.
 *
 * CRIT-1 (audit): two SDKs, two different casing conventions:
 *   @ai-sdk/google  → baseURL  (capital URL) — for generateText (translate, narrate)
 *   @google/genai   → httpOptions.baseUrl (lowercase u) — for generateContent + multimodal (STT)
 *
 * Both are now FACTORIES (functions, not consts): each call resolves the
 * current `beUrl()` so Settings.beUrl changes are picked up without restart.
 * The overhead of creating a provider per call is negligible (~0.1ms).
 *
 * apiKey "browser-placeholder" is intentional — OneCLI proxy replaces it at
 * the gateway. See learnings 2026-05-16: "OneCLI + AI SDK = placeholder apiKey pattern"
 */

import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { GoogleGenAI } from "@google/genai"
import { beUrl } from "$lib/util/be-url"

/**
 * For translation + narration — `generateText` / `generateObject` from `@ai-sdk/google`.
 * Note: this SDK uses `baseURL` (capital URL) — index.d.ts:494.
 * Callers use: googleAi("gemini-flash-lite-latest")
 * Same call signature as before (was a const provider, now a factory) — no
 * caller changes needed.
 */
export function googleAi(model: string) {
  const provider = createGoogleGenerativeAI({
    apiKey: "browser-placeholder", // placeholder; OneCLI injects real key at proxy
    baseURL: beUrl("/proxy/google/v1beta"),
  })
  return provider(model)
}

/**
 * For STT — multimodal `generateContent` with audio inline from `@google/genai`.
 * IMPORTANT: this SDK uses `httpOptions.baseUrl` (lowercase u) — web.d.ts:5904.
 * Wrong casing (`baseURL` instead of `baseUrl`) causes SDK to ignore the option
 * and hit generativelanguage.googleapis.com directly → CORS error + 401.
 * The baseUrl MUST be absolute — SDK passes it to `new URL()` eagerly.
 * `beUrl()` always returns an absolute URL in the browser.
 * baseUrl MUST end with `/` before the SDK appends apiVersion (`v1beta`).
 * Callers use: googleGenAi().models.generateContent(...)
 */
export function googleGenAi(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: "browser-placeholder",
    httpOptions: { baseUrl: beUrl("/proxy/google/") },
  })
}
