import { normalizePublicBaseUrl } from "@drive-coding/core/config/public-base-url"

const DEFAULT_ORIGINS = ["http://localhost:5173"]

export function parseCorsOrigins(raw: string | undefined): string | string[] {
  if (raw === undefined || raw.trim() === "") return DEFAULT_ORIGINS

  const trimmed = raw.trim()
  if (trimmed === "*") return "*"

  const origins = trimmed
    .split(",")
    .map((entry) => entry.trim().replace(/\/$/, ""))
    .filter((entry) => entry.length > 0)

  if (origins.length === 0) {
    throw new Error("Invalid CORS_ORIGINS: expected at least one origin")
  }

  for (const origin of origins) {
    let url: URL
    try {
      url = new URL(origin)
    } catch {
      throw new Error(`Invalid CORS_ORIGINS entry "${origin}": not a valid URL`)
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`Invalid CORS_ORIGINS entry "${origin}": scheme must be http/https`)
    }

    if (url.pathname !== "/" && url.pathname !== "") {
      throw new Error(`Invalid CORS_ORIGINS entry "${origin}": must not include path`)
    }
  }

  return origins.length === 1 ? origins[0]! : origins
}

export function effectiveCorsOrigins(
  rawCorsOrigins: string | undefined,
  publicBaseUrl: string | undefined,
): string | string[] {
  const parsed = parseCorsOrigins(rawCorsOrigins)
  const normalizedPublic = normalizePublicBaseUrl(publicBaseUrl ?? "")
  if (normalizedPublic === undefined) return parsed
  if (parsed === "*") return "*"

  const existing = Array.isArray(parsed) ? parsed : [parsed]
  if (existing.includes(normalizedPublic)) return existing
  return [...existing, normalizedPublic]
}
