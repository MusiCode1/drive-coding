/**
 * http-tts-capabilities.ts — GET /api/tts/capabilities endpoint.
 *
 * Slice: tts-provider-availability, Commit 1.
 * Extended by: tts-quota-subscription, Commit 1.
 *
 * Probes upstream TTS providers (ElevenLabs + Google) via the SAME auth path
 * as the regular proxy: resolveProviderAuth (env key) or placeholder (OneCLI injects).
 *
 * Results are cached in-memory for 60s to avoid expensive network calls on every request.
 *
 * IMPORTANT: never log auth header values — they are secrets.
 */

import type { ProbeResult } from "@drive-coding/core/tts/probe-status"
import { interpretProbeStatus } from "@drive-coding/core/tts/probe-status"
import type { QuotaVerdict } from "@drive-coding/core/tts/subscription"
import { interpretSubscription } from "@drive-coding/core/tts/subscription"
import { type } from "arktype"
import type { Hono } from "hono"
import { PROXY_HOSTS } from "./http-proxy.js"
import { resolveProviderAuth } from "./proxy-auth.js"

export type ProviderCapabilities = Record<"elevenlabs" | "google", ProbeResult>

// Probe endpoints — cheap read-only calls that reveal auth status without cost
const PROBE_PATHS: Record<string, string> = {
  elevenlabs: "/v1/voices",
  google: "/v1beta/models",
}

// Subscription endpoints — reveal quota status
const SUBSCRIPTION_PATHS: Record<string, string> = {
  elevenlabs: "/v1/user/subscription",
}

// Placeholder header names for OneCLI injection (when no env key is set)
const PLACEHOLDER_HEADER: Record<string, string> = {
  elevenlabs: "xi-api-key",
  google: "x-goog-api-key",
}

// ─── In-memory cache ─────────────────────────────────────────────────────────

const CACHE_TTL_MS = 60_000

type CacheEntry = { result: ProbeResult; ts: number }
const cache = new Map<string, CacheEntry>()

function getCached(provider: string): ProbeResult | null {
  const entry = cache.get(provider)
  if (!entry) return null
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(provider)
    return null
  }
  return entry.result
}

function setCached(provider: string, result: ProbeResult): void {
  cache.set(provider, { result, ts: Date.now() })
}

// ─── ArkType schema for /v1/user/subscription response ───────────────────────

const subscriptionResponseSchema = type({
  character_count: "number",
  character_limit: "number",
  status: "string",
  "max_character_limit_extension?": "number",
  "can_extend_character_limit?": "boolean",
  "+": "ignore", // allow (and drop) extra fields
})

// ─── Quota probe (ElevenLabs only) ───────────────────────────────────────────

/**
 * Fetches /v1/user/subscription (same auth path as probe), parses via ArkType,
 * interprets quota.
 *
 * Returns null when unsupported / fetch-fail / parse-fail → caller keeps probe result.
 * IMPORTANT: never log auth.value.
 */
async function probeElevenLabsQuota(env: NodeJS.ProcessEnv): Promise<QuotaVerdict | null> {
  const subscriptionPath = SUBSCRIPTION_PATHS["elevenlabs"]
  const base = PROXY_HOSTS["elevenlabs"]
  if (!base || !subscriptionPath) return null

  const url = base + subscriptionPath
  const headers = new Headers()

  // Inject auth: env key if available, otherwise placeholder for OneCLI
  const auth = resolveProviderAuth("elevenlabs", env)
  if (auth) {
    headers.set(auth.name, auth.value)
    // IMPORTANT: never log auth.value
  } else {
    headers.set("xi-api-key", "probe")
  }

  let json: unknown
  try {
    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    json = await res.json()
  } catch {
    return null
  }

  const parsed = subscriptionResponseSchema(json)
  if (parsed instanceof type.errors) {
    // parse-fail → null (caller keeps probe result, doesn't block)
    return null
  }

  return interpretSubscription({
    characterCount: parsed.character_count,
    characterLimit: parsed.character_limit,
    status: parsed.status,
    maxExtension: parsed.max_character_limit_extension,
    canExtend: parsed.can_extend_character_limit,
  })
}

// ─── Core probe logic ─────────────────────────────────────────────────────────

async function probeProvider(
  provider: "elevenlabs" | "google",
  env: NodeJS.ProcessEnv,
): Promise<ProbeResult> {
  const cached = getCached(provider)
  if (cached) return cached

  const base = PROXY_HOSTS[provider]
  const path = PROBE_PATHS[provider]
  if (!base || !path) {
    const result: ProbeResult = { available: false, reason: "error" }
    setCached(provider, result)
    return result
  }

  const url = `${base}${path}`
  const headers = new Headers()

  // Inject auth: env key if available, otherwise placeholder for OneCLI
  const auth = resolveProviderAuth(provider, env)
  if (auth) {
    headers.set(auth.name, auth.value)
    // IMPORTANT: never log auth.value
  } else {
    // Set placeholder so OneCLI (running as HTTPS_PROXY) can inject the real key
    const placeholderName = PLACEHOLDER_HEADER[provider]
    if (placeholderName) {
      headers.set(placeholderName, "probe")
    }
  }

  let status: number | null
  try {
    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(5000),
    })
    status = res.status
  } catch {
    status = null
  }

  const result = interpretProbeStatus(status)

  // NEW: quota gate — elevenlabs only, only when key is valid (result.available)
  if (provider === "elevenlabs" && result.available) {
    const quota = await probeElevenLabsQuota(env)
    if (quota?.exhausted) {
      const gated: ProbeResult = { available: false, reason: quota.reason }
      setCached(provider, gated)
      return gated
    }
  }

  setCached(provider, result)
  return result
}

// ─── Route registration ───────────────────────────────────────────────────────

export function registerTtsCapabilitiesHttp(app: Hono, env: NodeJS.ProcessEnv): void {
  app.get("/api/tts/capabilities", async (c) => {
    const [elevenlabs, google] = await Promise.all([
      probeProvider("elevenlabs", env),
      probeProvider("google", env),
    ])

    const capabilities: ProviderCapabilities = { elevenlabs, google }
    return c.json(capabilities)
  })
}
