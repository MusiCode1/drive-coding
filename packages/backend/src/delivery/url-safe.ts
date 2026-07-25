/**
 * url-safe.ts — pure URL helpers, never throw.
 *
 * Extracted from server.ts upgrade/connection handlers (Commit 2 — be-crash-hardening).
 * Using `new URL()` directly in an event handler throws TypeError on malformed request-targets
 * (e.g. "//[::1", "http://[") → uncaughtException → process.exit(1).
 *
 * safeUrlPathname wraps the construction: returns null on any error, pathname string on success.
 * Callers guard on null → socket.destroy() / ws.close() instead of crashing.
 */

/**
 * Safely parse a URL-like string and return its pathname.
 *
 * Uses `http://localhost` as a base so relative paths like "/ws/echo" resolve correctly.
 * Returns null if `new URL()` throws for any reason (malformed input).
 * Never throws.
 *
 * @param rawUrl - The raw URL string from an HTTP request (req.url) or undefined.
 * @returns The pathname string (e.g. "/ws/agent/abc") or null on parse failure.
 */
export function safeUrlPathname(rawUrl: string | undefined): string | null {
  try {
    return new URL(rawUrl ?? "", "http://localhost").pathname
  } catch {
    return null
  }
}
