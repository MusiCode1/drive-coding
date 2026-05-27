/**
 * translate-cache.ts — persistent localStorage cache for translation results.
 *
 * Keys: `voice-acp:translate:v1:<sha256(text|targetLang)>`
 * Values: JSON-encoded TranslateResult.
 *
 * On SSR (no window) all ops are no-ops. On QuotaExceeded the write fails
 * silently — we accept that under quota pressure the user just pays for a
 * re-translation next time.
 *
 * The key prefix includes a schema version `v1` so a future shape change can
 * be detected and skipped (or migrated) without colliding with old entries.
 */

import { createLogger } from "$lib/log"

const log = createLogger("fe.translate-cache")

const PREFIX = "voice-acp:translate:v1:"

/**
 * Discriminated union returned by translate(). Mirrors the JSON schema fed to
 * Gemini — `already_in_target` means the source text was already in the target
 * language and no synthesised translation is needed.
 */
export type TranslateResult =
  | { status: "already_in_target" }
  | { status: "translated"; text: string }

async function keyFor(text: string, targetLang: string): Promise<string> {
  const enc = new TextEncoder().encode(`${text}|${targetLang}`)
  const buf = await crypto.subtle.digest("SHA-256", enc)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

function safeLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage
  } catch {
    // SecurityError when storage is disabled (e.g. private mode in some browsers)
    return null
  }
}

export async function getCached(
  text: string,
  targetLang: string,
): Promise<TranslateResult | null> {
  const ls = safeLocalStorage()
  if (!ls) return null
  const key = PREFIX + (await keyFor(text, targetLang))
  const raw = ls.getItem(key)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as TranslateResult
    // Light sanity check — discard malformed entries
    if (
      parsed.status === "already_in_target" ||
      (parsed.status === "translated" && typeof parsed.text === "string")
    ) {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

export async function setCached(
  text: string,
  targetLang: string,
  value: TranslateResult,
): Promise<void> {
  const ls = safeLocalStorage()
  if (!ls) return
  const key = PREFIX + (await keyFor(text, targetLang))
  try {
    ls.setItem(key, JSON.stringify(value))
  } catch (e) {
    // QuotaExceededError — silently ignore; next call will re-translate
    log.warn({ err: e instanceof Error ? e.message : String(e) }, "cache write failed")
  }
}

/** Test helper — clears all v1 translation entries. */
export function clearTranslateCache(): number {
  const ls = safeLocalStorage()
  if (!ls) return 0
  let removed = 0
  for (let i = ls.length - 1; i >= 0; i--) {
    const k = ls.key(i)
    if (k && k.startsWith(PREFIX)) {
      ls.removeItem(k)
      removed++
    }
  }
  return removed
}
