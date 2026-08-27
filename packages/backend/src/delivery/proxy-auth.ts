/**
 * proxy-auth.ts — resolves upstream auth headers from env for the HTTP proxy.
 *
 * Slice: voice-keys-direct, Commit 0.
 *
 * Pure function — no global reads; env is injected.
 * Returns null when no key is configured → caller passes headers through as-is
 * (OneCLI injects its own keys via HTTPS_PROXY).
 */

export type ProviderAuth = { name: string; value: string }

/**
 * Returns the auth header to inject into upstream request, or null when no key is set.
 *
 * elevenlabs → xi-api-key from ELEVENLABS_API_KEY.
 * google     → x-goog-api-key from GEMINI_API_KEY.
 * Unknown provider or missing/empty key → null (passthrough).
 *
 * IMPORTANT: never log the returned value — it contains a secret key.
 */
export function resolveProviderAuth(provider: string, env: NodeJS.ProcessEnv): ProviderAuth | null {
  if (provider === "elevenlabs") {
    const key = env["ELEVENLABS_API_KEY"]
    if (!key) return null
    return { name: "xi-api-key", value: key }
  }

  if (provider === "google") {
    const key = env["GEMINI_API_KEY"]
    if (!key) return null
    return { name: "x-goog-api-key", value: key }
  }

  return null
}
