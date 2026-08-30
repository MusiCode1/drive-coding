/** Normalize a public origin. Returns undefined when the value is not a bare origin. */
export function normalizePublicBaseUrl(raw: string): string | undefined {
  const trimmed = raw.trim()
  if (trimmed === "") return undefined

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return undefined
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined

  if (url.pathname !== "" && url.pathname !== "/") return undefined
  if (url.search !== "") return undefined
  if (url.hash !== "") return undefined

  return url.origin
}
