/**
 * Hashing helpers for cache key generation.
 * Uses the Web Crypto API (available in Node 22+ and Bun).
 */

/** Returns a hex-encoded SHA-256 digest of the input string. */
export async function sha256Key(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input)
  const hash = await crypto.subtle.digest("SHA-256", buf)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}
