/**
 * cloudflare-detect.ts — זיהוי חתימת Cloudflare בכשל presence (slice liveness C4).
 */

const BODY_MARKERS = [
  "Just a moment",
  "cf-browser-verification",
  "challenge-platform",
  "Cloudflare Ray ID",
] as const

export function isCloudflareChallenge(
  res: Response | null | undefined,
  body = "",
): boolean {
  if (res?.headers.get("cf-ray")) return true
  const server = res?.headers.get("server")?.toLowerCase() ?? ""
  if (server.includes("cloudflare")) return true
  for (const marker of BODY_MARKERS) {
    if (body.includes(marker)) return true
  }
  return false
}

/**
 * רענון מאובחן — בודק ש-/ עדיין נגיש לפני reload (§C4).
 * best-effort; לא זורק.
 */
export async function diagnosedRefresh(probeUrl: string): Promise<void> {
  if (typeof location === "undefined") return
  try {
    const res = await fetch(probeUrl, { method: "GET", cache: "no-store" })
    if (res.ok) location.reload()
  } catch {
    // נשארים על הבאנר — המשתמשת תנסה שוב
  }
}
