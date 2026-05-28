/**
 * sdks.ts — singleton SDK instances configured for our BE proxy.
 *
 * CRIT-1 (audit): two SDKs, two different casing conventions:
 *   @ai-sdk/google  → baseURL  (capital URL) — for generateText (translate, narrate)
 *   @google/genai   → httpOptions.baseUrl (lowercase u) — for generateContent + multimodal (STT)
 *
 * apiKey "browser-placeholder" is intentional — OneCLI proxy replaces it at the gateway.
 * See learnings 2026-05-16: "OneCLI + AI SDK = placeholder apiKey pattern"
 */

import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { GoogleGenAI } from "@google/genai"

// SDK init runs at module-load time (incl. SSR — `location` is undefined there).
// We use a stub in SSR; the real value resolves in the browser at runtime.
// `@ai-sdk/google` accepts relative `baseURL` (fetch resolves against window).
// `@google/genai` calls `new URL(httpOptions.baseUrl)` eagerly → REQUIRES absolute.
const browserOrigin =
  typeof window !== "undefined" ? window.location.origin : "http://ssr-stub.local"

/**
 * For translation + narration — `generateText` / `generateObject` from `@ai-sdk/google`.
 * Note: this SDK uses `baseURL` (capital URL) — index.d.ts:494.
 */
export const googleAi = createGoogleGenerativeAI({
  apiKey: "browser-placeholder", // placeholder; OneCLI injects real key at proxy
  baseURL: `${browserOrigin}/proxy/google/v1beta`,
})

/**
 * For STT — multimodal `generateContent` with audio inline from `@google/genai`.
 * IMPORTANT: this SDK uses `httpOptions.baseUrl` (lowercase u) — web.d.ts:5904.
 * Wrong casing (`baseURL` instead of `baseUrl`) causes SDK to ignore the option
 * and hit generativelanguage.googleapis.com directly → CORS error + 401.
 * The baseUrl MUST be absolute — SDK passes it to `new URL()` eagerly.
 * baseUrl MUST end with `/` before the SDK appends apiVersion (`v1beta`).
 */
export const googleGenAi = new GoogleGenAI({
  apiKey: "browser-placeholder",
  httpOptions: { baseUrl: `${browserOrigin}/proxy/google/` },
})
