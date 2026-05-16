export async function cacheKeyFor(text: string, voiceId: string, modelId: string): Promise<string> {
  const input = `${modelId}|${voiceId}|${text}`
  const buf = new TextEncoder().encode(input)
  const hash = await crypto.subtle.digest("SHA-256", buf)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}
