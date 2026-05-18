/**
 * cwd-hash.ts — deterministic SHA-256 hash of a cwd path.
 *
 * Uses the Web Crypto API (globalThis.crypto.subtle) which is available
 * in Node 22.5+ and all modern browsers — no Node-only imports.
 *
 * Output format: base64url, no padding (same as Node's
 *   createHash('sha256').update(cwd).digest('base64url')).
 *
 * This is the single source of truth for cwdHash used by both BE and FE.
 * BE previously had a local copy in http-history.ts — that is replaced by
 * this import.
 */

/** base64url encoding without padding (RFC 4648 §5). */
function toBase64Url(bytes: Uint8Array): string {
  // btoa is available in both Node 16+ and browsers
  let b64 = btoa(String.fromCharCode(...bytes))
  // Replace base64 chars with base64url equivalents and strip padding
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/**
 * Hash a working-directory path to a URL-safe base64url string.
 *
 * Async because crypto.subtle.digest is async in the Web Crypto API.
 * In practice this is ~microseconds; safe to await in hot paths.
 */
export async function cwdToHash(cwd: string): Promise<string> {
  const data = new TextEncoder().encode(cwd)
  const buf = await globalThis.crypto.subtle.digest("SHA-256", data)
  return toBase64Url(new Uint8Array(buf))
}
