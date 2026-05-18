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

const PROXY_BASE = `${location.protocol}//${location.host}`

/**
 * For translation + narration — `generateText` from `@ai-sdk/google`.
 * Note: this SDK uses `baseURL` (capital URL) — index.d.ts:494.
 */
export const googleAi = createGoogleGenerativeAI({
  apiKey: "browser-placeholder", // placeholder; OneCLI injects real key at proxy
  baseURL: `${PROXY_BASE}/proxy/google/v1beta`,
})

/**
 * For STT — multimodal `generateContent` with audio inline from `@google/genai`.
 * IMPORTANT: this SDK uses `httpOptions.baseUrl` (lowercase u) — web.d.ts:5904.
 * Wrong casing (`baseURL` instead of `baseUrl`) causes SDK to ignore the option
 * and hit generativelanguage.googleapis.com directly → CORS error + 401.
 * The baseUrl MUST end with `/` before the SDK appends apiVersion (`v1beta`).
 */
export const googleGenAi = new GoogleGenAI({
  apiKey: "browser-placeholder",
  httpOptions: { baseUrl: `${PROXY_BASE}/proxy/google/` }, // lowercase 'u', trailing slash required
})
